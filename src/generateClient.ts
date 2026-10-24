import type { GenerateRequest, GenerateSuccess } from "shared/generate";
import { errorMessage } from "./actionsClient";

export type GenerateOutcome =
  | { kind: "ok"; design: GenerateSuccess }
  /** The model's design still had problems after its tries. */
  | { kind: "invalid"; problems: string[] }
  | { kind: "error"; message: string };

/**
 * Posts one prompt. Network and HTTP failures resolve to `{ kind: "error" }`
 * so the caller always has something to show.
 */
export async function generate(req: GenerateRequest, signal?: AbortSignal): Promise<GenerateOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      signal,
    });
  } catch {
    return { kind: "error", message: "Couldn't reach the server." };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const result = body as { ok?: unknown; id?: unknown; tree?: unknown; problems?: unknown } | null | undefined;
  if (response.ok && result?.ok === true && typeof result.id === "string" && result.tree) {
    return { kind: "ok", design: result as unknown as GenerateSuccess };
  }
  if (response.status === 422 && result?.ok === false) {
    return { kind: "invalid", problems: Array.isArray(result.problems) ? result.problems.map(String) : [] };
  }
  return { kind: "error", message: errorMessage(body) ?? `Request failed (${response.status})` };
}
