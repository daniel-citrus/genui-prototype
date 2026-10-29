import type { ActionResult, ActionRunRequest } from "shared/api";
import { nearestCard, sendsInput } from "shared/formScope";
import type { GenerateSuccess } from "shared/generate";
import type { UiNode } from "shared/ui";
import { runAction } from "./actionsClient";
import { generate } from "./generateClient";
import { lockScope } from "./lockScope";
import { actionValues, type FieldReading } from "./sandbox/actionValues";
import { components, el } from "./sandbox/components";
import { renderEmpty, renderUi } from "./sandbox/render";

const promptClass =
  "max-w-[80%] self-end whitespace-pre-wrap rounded-2xl bg-sky-700 px-3 py-2 text-sm leading-snug text-white";
const canvasClass = "rounded-xl border border-dashed border-zinc-300 bg-white p-4 shadow-inner";
const notesClass = {
  notes: "whitespace-pre-wrap rounded-lg bg-zinc-100 px-3 py-2 text-sm leading-snug text-zinc-900",
  error: "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900",
};
const replyClass = {
  ok: "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900",
  failed: "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900",
  confirm: "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900",
};
const confirmButtonClass = {
  yes: "pressable rounded-md bg-amber-700 px-3 py-1 text-sm font-medium text-white shadow-sm hover:bg-amber-800",
  cancel: "pressable rounded-md border border-zinc-300 bg-white px-3 py-1 text-sm font-medium text-zinc-700 hover:bg-zinc-50",
};
const lockedClass = ["cursor-not-allowed", "opacity-50"];

const hiddenFieldMessage = "This design has a hidden field, so the action was not sent.";
const liveFormsNote = "The other forms here still work.";
const staleFormsNote = "The other forms here are out of date now, so ask again for a fresh one.";
const invalidMessage = "The design still had problems after 3 tries. Try rewording the prompt.";

/** One design in the transcript. Only the newest is live. */
interface Design {
  /** Actions name the design by it. */
  id: string;
  tree: UiNode;
  /** Holds the drawn tree. Designs share tree paths, so every field lookup stays inside it. */
  canvas: HTMLElement;
  /** The Done and Replaced labels above the design. */
  labels: HTMLElement;
  /** An action's result or confirm question, under the notes. */
  reply: HTMLElement;
  replaced: boolean;
  /** The Cards earlier successes locked; their stale dropdowns can send nothing. */
  lockedCards: string[];
  actionInFlight: boolean;
  /** Set while the reply asks an action's confirm question. */
  confirmShown: boolean;
}

export interface Chat {
  /** Set while a prompt's design is being generated. */
  readonly generating: boolean;
  /** Adds the prompt to the transcript, then its design with notes, or an error. Resolves false after an error. */
  send(prompt: string): Promise<boolean>;
}

function badge(text: string, tone: "success" | "neutral"): HTMLElement {
  return components.Badge({ text, tone }, [], "");
}

function replyButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = el("button", className, label);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

/** Reads every named field of `controls`. */
function readFields(controls: Array<HTMLInputElement | HTMLSelectElement>): FieldReading[] {
  return controls
    .filter((control) => control.name)
    .map((control) => {
      if (control instanceof HTMLSelectElement) {
        return { name: control.name, kind: "select", value: control.value, checked: false };
      }
      const kind = control.type === "checkbox" ? "checkbox" : control.type === "password" ? "password" : "text";
      return { name: control.name, kind, value: control.value, checked: control.checked };
    });
}

/** Whether the person can't see `control`, so a click would send a value they never saw. */
function isHidden(control: Element): boolean {
  const box = control.getBoundingClientRect();
  return (
    !control.checkVisibility({ opacityProperty: true, visibilityProperty: true }) || box.width < 1 || box.height < 1
  );
}

/** Disables and dims every control in `root` for good: without `data-action`, `syncActionButtons` leaves a button off. */
function disableControls(root: HTMLElement) {
  for (const control of root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
    "input, select, button",
  )) {
    control.disabled = true;
    delete control.dataset.action;
    control.classList.add(...lockedClass);
  }
}

/** Marks the part of `design` at `scope` (a Card's path, or "tree") Done and disables it. */
function lock(design: Design, scope: string) {
  const card = scope === "tree" ? null : design.canvas.querySelector<HTMLElement>(`[data-card="${scope}"]`);
  disableControls(card ?? design.canvas);
  if (card) {
    card.prepend(badge("Done", "success"));
    design.lockedCards.push(scope);
  } else design.labels.append(badge("Done", "success"));
}

/** Shows a reply under the design's notes in place of the last one; no `tone` clears it. Either drops a confirm question. */
function showReply(design: Design, tone?: keyof typeof replyClass, ...content: Array<Node | string>) {
  design.confirmShown = false;
  design.reply.className = tone ? replyClass[tone] : "";
  design.reply.replaceChildren(...content);
  // A late result for a replaced design doesn't pull the person away from the newest one.
  if (tone && !design.replaced) design.reply.scrollIntoView({ block: "nearest" });
}

/** The transcript in `container`: each prompt with its design, notes and action replies below it. */
export function createChat(container: HTMLElement): Chat {
  renderEmpty(container);
  let started = false;
  /** The newest design; the older ones are replaced. */
  let latest: Design | null = null;
  let generating = false;

  /** Action buttons wait out a generation, an action in flight or a confirm question. */
  function syncActionButtons(design: Design) {
    const busy = design.actionInFlight || design.confirmShown || (generating && design === latest);
    for (const button of design.canvas.querySelectorAll<HTMLButtonElement>("button[data-action]")) {
      button.disabled = busy;
    }
  }

  /** A newer design arrived: `design` stops taking clicks and drops an unanswered question. */
  function replace(design: Design) {
    design.replaced = true;
    if (design.confirmShown) showReply(design);
    disableControls(design.canvas);
    design.labels.append(badge("Replaced by a newer design.", "neutral"));
  }

  /**
   * Puts focus back after `button`'s action when the control that had it was
   * disabled or removed: on `button` while it still works, else on the reply.
   * It never takes focus from elsewhere, or for a replaced design.
   */
  function restoreFocus(design: Design, button: HTMLButtonElement) {
    const active = document.activeElement;
    const lost = !active || active === document.body || active === button || design.reply.contains(active);
    if (design.replaced || !lost) return;
    (button.isConnected && !button.disabled ? button : design.reply).focus({ preventScroll: true });
  }

  /**
   * Asks an action's confirm question under the design. Yes resends `request`,
   * with the values read for the first click, as confirmed; Cancel sends nothing.
   */
  function askConfirm(design: Design, request: ActionRunRequest, button: HTMLButtonElement, question: string) {
    const buttons = el("div", "mt-2 flex gap-2");
    buttons.append(
      replyButton("Yes", confirmButtonClass.yes, () => {
        showReply(design);
        void postAction(design, { ...request, confirmed: true }, button);
      }),
      replyButton("Cancel", confirmButtonClass.cancel, () => {
        showReply(design);
        syncActionButtons(design);
        restoreFocus(design, button);
      }),
    );
    showReply(design, "confirm", el("p", "", question), buttons);
    design.confirmShown = true;
  }

  /** Shows an action's result. A success locks the clicked button's Card, or the whole design (`lockScope`). */
  function showResult(design: Design, result: ActionResult, buttonPath: string) {
    if (!result.ok) {
      showReply(design, "failed", result.message);
      return;
    }
    const card = nearestCard(design.tree, buttonPath);
    const scope = lockScope(design.tree, buttonPath, result.stale, design.lockedCards);
    lock(design, scope);
    let note = "";
    if (!design.replaced) {
      if (card !== undefined && scope !== card) note = staleFormsNote;
      else if (design.canvas.querySelector("button[data-action]")) note = liveFormsNote;
    }
    showReply(design, "ok", ["Done!", result.message, note].filter(Boolean).join(" "));
  }

  /** Posts `button`'s action request and shows its result, or asks its confirm question. */
  async function postAction(design: Design, request: ActionRunRequest, button: HTMLButtonElement) {
    const buttonPath = button.dataset.path ?? "";
    design.actionInFlight = true;
    syncActionButtons(design);
    try {
      const result = await runAction(request);
      if (result.confirm !== undefined) {
        // Nothing ran; a question for a design the person has left is dropped.
        if (!design.replaced) askConfirm(design, request, button, result.confirm);
        return;
      }
      showResult(design, result, buttonPath);
    } finally {
      design.actionInFlight = false;
      syncActionButtons(design);
      restoreFocus(design, button);
    }
  }

  function sendAction(design: Design, button: HTMLButtonElement, action: string) {
    const buttonPath = button.dataset.path ?? "";
    // Only the fields the server will accept from this button: those in its nearest Card, or all without one.
    const controls = [...design.canvas.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")].filter(
      (control) => sendsInput(design.tree, buttonPath, control.dataset.path ?? ""),
    );
    // Markup styles can put a field out of sight; the server and filterMarkup refuse the known ways.
    if (controls.some((control) => control.name && isHidden(control))) {
      showReply(design, "failed", hiddenFieldMessage);
      return;
    }
    const invalid = controls.find((control) => !control.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      return;
    }
    void postAction(design, { designId: design.id, action, values: actionValues(readFields(controls)) }, button);
  }

  /** Draws `success` into its reply entry: labels, the design, its notes, then room for action replies. */
  function showDesign(entry: HTMLElement, success: GenerateSuccess): Design {
    const design: Design = {
      id: success.id,
      tree: success.tree,
      canvas: el("div", canvasClass),
      labels: el("div", "flex flex-wrap gap-2 empty:hidden"),
      reply: el("div", ""),
      replaced: false,
      lockedCards: [],
      actionInFlight: false,
      confirmShown: false,
    };
    design.reply.setAttribute("role", "status");
    // Takes focus when the clicked button can't keep it.
    design.reply.tabIndex = -1;
    renderUi(success.tree, design.canvas);
    design.canvas.addEventListener("click", (e) => {
      const button = (e.target as Element).closest<HTMLButtonElement>("button[data-action]");
      if (!button?.dataset.action || button.disabled) return;
      sendAction(design, button, button.dataset.action);
    });
    entry.replaceChildren(design.labels, design.canvas);
    if (success.notes) entry.append(el("p", notesClass.notes, success.notes));
    entry.append(design.reply);
    return design;
  }

  async function send(prompt: string): Promise<boolean> {
    generating = true;
    if (latest) syncActionButtons(latest);
    if (!started) container.replaceChildren();
    started = true;
    const message = el("p", promptClass, prompt);
    const entry = el("article", "flex flex-col gap-2");
    entry.append(el("p", notesClass.notes, "Generating… This can take a minute."));
    container.append(message, entry);
    message.scrollIntoView({ block: "start" });
    try {
      const outcome = await generate({ prompt });
      if (outcome.kind === "ok") {
        if (latest) replace(latest);
        latest = showDesign(entry, outcome.design);
      } else {
        const error = outcome.kind === "invalid" ? invalidMessage : outcome.message;
        entry.replaceChildren(el("p", notesClass.error, error));
      }
      message.scrollIntoView({ block: "start" });
      return outcome.kind === "ok";
    } finally {
      generating = false;
      if (latest) syncActionButtons(latest);
    }
  }

  return {
    get generating() {
      return generating;
    },
    send,
  };
}
