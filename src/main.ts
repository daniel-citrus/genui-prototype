import "./style.css";
import { type ActionResult, type ActionRunRequest } from "shared/api";
import { MAX_PROMPT_CHARS } from "shared/generate";
import { sendsInput } from "shared/formScope";
import type { UiNode } from "shared/ui";
import { runAction } from "./actionsClient";
import { createCustomComponentsPanel } from "./customComponentsPanel";
import { generate } from "./generateClient";
import { actionValues, type FieldReading } from "./sandbox/actionValues";
import { renderEmpty, renderUi } from "./sandbox/render";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app missing");

const statusBaseClass = "sandbox-status shrink-0 text-sm";
const statusToneClass = {
  ok: "mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900",
  failed: "mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-900",
  confirm: "mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900",
};
const confirmButtonClass = {
  yes: "rounded-md bg-amber-600 px-3 py-1 text-sm font-medium text-white shadow-sm hover:bg-amber-700",
  cancel: "rounded-md border border-zinc-300 bg-white px-3 py-1 text-sm font-medium text-zinc-700 hover:bg-zinc-50",
};
const notesClass = {
  notes: "whitespace-pre-wrap rounded-lg bg-zinc-100 px-3 py-2 text-sm leading-snug text-zinc-900",
  error: "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900",
};

app.innerHTML = `
  <div class="grid h-full min-h-0 grid-cols-2 bg-zinc-50 text-zinc-900">
    <section class="flex min-h-0 min-w-0 flex-col border-r border-zinc-200 bg-white" aria-label="Prompt">
      <header class="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-4 py-3">
        <h1 class="text-sm font-semibold text-zinc-700">Describe a UI</h1>
        <button
          type="button"
          class="components-toggle ml-auto shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 aria-expanded:bg-sky-50 aria-expanded:text-sky-800"
          aria-controls="components-panel"
          aria-expanded="false"
        >
          Components
        </button>
      </header>
      <div class="prompt-body relative flex min-h-0 flex-1 flex-col">
        <form class="composer shrink-0 border-b border-zinc-200 bg-zinc-50/80 px-4 py-3" aria-label="Generate a design">
          <textarea
            name="prompt"
            rows="4"
            maxlength="${MAX_PROMPT_CHARS}"
            placeholder="Describe the UI you want…"
            aria-label="Prompt"
            class="mb-2 w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm outline-none placeholder:text-zinc-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
          ></textarea>
          <div class="flex justify-end">
            <button
              type="submit"
              class="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sky-700 active:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Generate
            </button>
          </div>
        </form>
        <div class="notes min-h-0 flex-1 overflow-y-auto px-4 py-4" role="status"></div>
      </div>
    </section>
    <section class="flex min-h-0 min-w-0 flex-col bg-zinc-100/80 p-4" aria-label="Sandbox">
      <div class="${statusBaseClass}" role="status"></div>
      <div class="sandbox-canvas min-h-0 flex-1 overflow-y-auto rounded-xl border border-dashed border-zinc-300 bg-white p-4 shadow-inner"></div>
    </section>
  </div>
`;

const form = app.querySelector<HTMLFormElement>(".composer");
const textarea = app.querySelector<HTMLTextAreaElement>('textarea[name="prompt"]');
const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
const notes = app.querySelector<HTMLDivElement>(".notes");
const sandbox = app.querySelector<HTMLDivElement>(".sandbox-canvas");
const sandboxStatus = app.querySelector<HTMLDivElement>(".sandbox-status");
if (sandbox) renderEmpty(sandbox);

// Opens over the prompt pane; its previews are drawn there, outside the sandbox.
const componentsPanel = createCustomComponentsPanel();
app.querySelector(".prompt-body")?.append(componentsPanel.element);
const componentsToggle = app.querySelector<HTMLButtonElement>(".components-toggle");
componentsToggle?.addEventListener("click", () => {
  componentsToggle.setAttribute("aria-expanded", String(componentsPanel.toggle()));
});

/** The `id` of the design shown in the sandbox; actions name it. */
let shownUiId: string | null = null;
let shownTree: UiNode | null = null;
let generating = false;
let actionInFlight = false;
/** Set while the status area asks an action's confirm question. */
let confirmShown = false;

/** Action buttons wait out a generation, an action in flight or a confirm question. Buttons the design disables have no `data-action`, so they stay disabled. */
function syncActionButtons() {
  const busy = actionInFlight || generating || confirmShown;
  for (const button of sandbox?.querySelectorAll<HTMLButtonElement>("button[data-action]") ?? []) {
    button.disabled = busy;
  }
}

function showNotes(text: string, tone: keyof typeof notesClass = "notes") {
  if (!notes) return;
  notes.replaceChildren();
  if (!text) return;
  const el = document.createElement("p");
  el.className = notesClass[tone];
  el.textContent = text;
  notes.appendChild(el);
}

/** Shows an action's result above the design; `null` clears it. Either drops a confirm question. */
function showStatus(result: ActionResult | null) {
  confirmShown = false;
  if (!sandboxStatus) return;
  sandboxStatus.className = result
    ? `${statusBaseClass} ${result.ok ? statusToneClass.ok : statusToneClass.failed}`
    : statusBaseClass;
  sandboxStatus.textContent = result?.message ?? "";
}

function statusButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

/**
 * Asks an action's confirm question above the design instead of a result. Yes
 * resends `request`, with the values read for the first click, as confirmed;
 * Cancel sends nothing.
 */
function askConfirm(request: ActionRunRequest, question: string) {
  if (!sandboxStatus) return;
  const text = document.createElement("p");
  text.textContent = question;
  const buttons = document.createElement("div");
  buttons.className = "mt-2 flex gap-2";
  buttons.append(
    statusButton("Yes", confirmButtonClass.yes, () => {
      showStatus(null);
      void postAction({ ...request, confirmed: true });
    }),
    statusButton("Cancel", confirmButtonClass.cancel, () => {
      showStatus(null);
      syncActionButtons();
    }),
  );
  sandboxStatus.className = `${statusBaseClass} ${statusToneClass.confirm}`;
  sandboxStatus.replaceChildren(text, buttons);
  confirmShown = true;
}

async function sendPrompt(prompt: string) {
  generating = true;
  if (submitButton) submitButton.disabled = true;
  // A new generation drops an unanswered confirm question.
  if (confirmShown) showStatus(null);
  syncActionButtons();
  showNotes("Generating…");
  try {
    const outcome = await generate({ prompt });
    if (outcome.kind === "ok") {
      if (sandbox) renderUi(outcome.design.tree, sandbox);
      shownUiId = outcome.design.id;
      shownTree = outcome.design.tree;
      showStatus(null);
      showNotes(outcome.design.notes);
    } else if (outcome.kind === "invalid") {
      showNotes("The design still had problems after 3 tries.", "error");
    } else {
      showNotes(outcome.message, "error");
    }
  } finally {
    generating = false;
    if (submitButton) submitButton.disabled = false;
    syncActionButtons();
  }
}

/** Reads every named field of the shown design. */
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

async function sendAction(button: HTMLButtonElement, action: string) {
  if (!sandbox || !shownUiId) return;
  // Only the fields the server will accept from this button: those in its nearest Card, or all without one.
  const controls = [...sandbox.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")].filter(
    (control) => sendsInput(shownTree, button.dataset.path ?? "", control.dataset.path ?? ""),
  );
  // Markup styles can put a field out of sight; the server and filterMarkup refuse the known ways.
  if (controls.some((control) => control.name && isHidden(control))) {
    showStatus({ ok: false, message: "This design has a hidden field, so the action was not sent." });
    return;
  }
  const invalid = controls.find((control) => !control.checkValidity());
  if (invalid) {
    invalid.reportValidity();
    return;
  }

  await postAction({ designId: shownUiId, action, values: actionValues(readFields(controls)) });
}

/** Posts an action request and shows its result, or asks its confirm question. */
async function postAction(request: ActionRunRequest) {
  actionInFlight = true;
  syncActionButtons();
  try {
    const result = await runAction(request);
    // A design drawn meanwhile has already cleared the status area for itself.
    const sameDesign = shownUiId === request.designId;
    if (result.confirm !== undefined) {
      // Nothing ran; a question for a design the person has left is dropped.
      if (sameDesign) askConfirm(request, result.confirm);
      return;
    }
    if (sameDesign) showStatus(result);
  } finally {
    actionInFlight = false;
    syncActionButtons();
  }
}

sandbox?.addEventListener("click", (e) => {
  const button = (e.target as Element).closest<HTMLButtonElement>("button[data-action]");
  if (!button?.dataset.action || button.disabled) return;
  void sendAction(button, button.dataset.action);
});

form?.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = textarea?.value.trim();
  if (!text || generating) return;
  void sendPrompt(text);
});

textarea?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form?.requestSubmit();
  }
});
