import type { UiNode } from "shared/ui";
import type { ComponentLlm, LlmMessage, LlmUsage } from "../ports/ComponentLlm";
import type { ComponentRepository } from "../ports/ComponentRepository";
import { isObject } from "../ui/bindings";
import { checkDesign, type DesignCheckDeps } from "./checkDesign";
import { buildContext, type ContextDeps } from "./context";
import { buildMessages, repairMessages } from "./prompt";

/** Model calls at most: the first try and two repairs. */
export const MAX_ATTEMPTS = 3;
/** Notes are cut to this many characters. */
export const MAX_NOTES_CHARS = 500;

const BAD_REPLY = 'Reply was not a JSON object with "tree" and "notes"';
const CUT_OFF = "Reply was cut off; make the design smaller";

export interface GenerateDeps extends Omit<DesignCheckDeps, "catalog"> {
  llm: ComponentLlm;
  components: ComponentRepository;
  /** With it, the context also lists dropdown values grouped, for sources that have groups. */
  listChoiceGroups?: ContextDeps["listChoiceGroups"];
  /** An empty list each attempt is appended to as it is made, so the caller keeps them when the generation rejects. */
  attempts?: GenerationAttempt[];
}

export interface GenerationAttempt {
  /** The user message that asked for this attempt; absent on the first. */
  repairPrompt?: string;
  content: string | null;
  truncated: boolean;
  usage?: LlmUsage;
  /** The model's own tree, before expansion, when the reply parsed. */
  tree?: unknown;
  problems: string[];
}

export type Generation =
  | { ok: true; tree: UiNode; notes: string; attempts: GenerationAttempt[] }
  | { ok: false; problems: string[]; attempts: GenerationAttempt[] };

/** The reply's tree and notes, or undefined when it isn't `{ tree: {...}, notes: string }`. */
function parseReply(content: string | null): { tree: unknown; notes: string } | undefined {
  if (!content) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (!isObject(parsed) || !isObject(parsed.tree) || typeof parsed.notes !== "string") return undefined;
  return { tree: parsed.tree, notes: parsed.notes };
}

/**
 * Designs a UI for `prompt` with one model call, repairing it up to twice
 * when the reply or the design has problems. A design with problems gives
 * `ok: false`; it never rejects. Rejects when the catalog can't be read, the
 * model call fails, custom components are unavailable, or the signal aborts
 * (with an `AbortError`).
 */
export async function generateComponent(prompt: string, deps: GenerateDeps): Promise<Generation> {
  const { llm, components, listChoiceGroups, signal, attempts = [], ...checkDeps } = deps;
  const context = await buildContext(prompt, deps);
  const messages: LlmMessage[] = buildMessages(context, prompt);
  let repairPrompt: string | undefined;

  for (;;) {
    if (signal.aborted) throw new DOMException("The generation was aborted", "AbortError");
    const reply = await llm.complete({ messages, signal });
    const attempt: GenerationAttempt = {
      ...(repairPrompt !== undefined ? { repairPrompt } : {}),
      content: reply.content,
      truncated: reply.truncated,
      ...(reply.usage ? { usage: reply.usage } : {}),
      problems: [],
    };
    attempts.push(attempt);

    const parsed = reply.truncated ? undefined : parseReply(reply.content);
    if (parsed) {
      attempt.tree = parsed.tree;
      const check = await checkDesign(parsed.tree, { ...checkDeps, catalog: context.catalog, signal });
      if (check.ok) {
        return { ok: true, tree: check.tree, notes: parsed.notes.trim().slice(0, MAX_NOTES_CHARS), attempts };
      }
      attempt.problems = check.problems;
    } else {
      attempt.problems = reply.truncated ? [BAD_REPLY, CUT_OFF] : [BAD_REPLY];
    }

    if (attempts.length >= MAX_ATTEMPTS) return { ok: false, problems: attempt.problems, attempts };
    const repair = repairMessages(reply.content, attempt.problems);
    messages.push(...repair);
    repairPrompt = repair.at(-1)!.content;
  }
}
