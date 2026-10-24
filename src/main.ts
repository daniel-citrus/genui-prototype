import "./style.css";
import { MAX_MESSAGE_CHARS, type ActionResult, type ActionRunRequest, type AgentEvent } from "shared/api";
import { sendsInput } from "shared/formScope";
import type { UiNode } from "shared/ui";
import { runAction } from "./actionsClient";
import { streamChat } from "./agentClient";
import { threadEffect, thinkingAfter } from "./chatEvents";
import { createCustomComponentsPanel } from "./customComponentsPanel";
import { actionValues, type FieldReading } from "./sandbox/actionValues";
import { renderEmpty, renderUi } from "./sandbox/render";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app missing");

const userTurnClass =
  "self-end max-w-[85%] rounded-2xl rounded-br-md bg-sky-600 px-4 py-2.5 text-sm leading-snug text-white shadow-sm";
const assistantTurnClass =
  "self-start max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-zinc-100 px-4 py-2.5 text-sm leading-snug text-zinc-900 shadow-sm";
const systemLineClass = "self-start px-1 text-xs text-zinc-500";
const errorLineClass = "self-start rounded-md bg-red-50 px-2 py-1 text-xs text-red-700";
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

/** One conversation per page load; the server keeps its history. */
const conversationId = crypto.randomUUID();

app.innerHTML = `
  <div class="grid h-full min-h-0 grid-cols-2 bg-zinc-50 text-zinc-900">
    <section class="flex min-h-0 min-w-0 flex-col border-r border-zinc-200 bg-white" aria-label="Agent chat">
      <header class="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-4 py-3">
        <label class="sr-only" for="session-select">Session</label>
        <select
          id="session-select"
          aria-label="Session"
          class="w-full max-w-xs rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 shadow-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
        ></select>
        <button
          type="button"
          class="components-toggle ml-auto shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 aria-expanded:bg-sky-50 aria-expanded:text-sky-800"
          aria-controls="components-panel"
          aria-expanded="false"
        >
          Components
        </button>
      </header>
      <div class="chat-body relative flex min-h-0 flex-1 flex-col">
        <div
          class="thread flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
        ></div>
        <form class="composer shrink-0 border-t border-zinc-200 bg-zinc-50/80 px-4 py-3" aria-label="Send a message">
          <textarea
            name="message"
            rows="3"
            maxlength="${MAX_MESSAGE_CHARS}"
            placeholder="Message the agent…"
            aria-label="Message"
            class="mb-2 w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm outline-none placeholder:text-zinc-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
          ></textarea>
          <div class="flex justify-end">
            <button
              type="submit"
              class="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sky-700 active:bg-sky-800"
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </section>
    <section class="flex min-h-0 min-w-0 flex-col bg-zinc-100/80 p-4" aria-label="Sandbox">
      <div class="${statusBaseClass}" role="status"></div>
      <div class="sandbox-canvas min-h-0 flex-1 overflow-y-auto rounded-xl border border-dashed border-zinc-300 bg-white p-4 shadow-inner"></div>
    </section>
  </div>
`;

const form = app.querySelector<HTMLFormElement>(".composer");
const textarea = app.querySelector<HTMLTextAreaElement>('textarea[name="message"]');
const thread = app.querySelector<HTMLDivElement>(".thread");
const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
const sandbox = app.querySelector<HTMLDivElement>(".sandbox-canvas");
const sandboxStatus = app.querySelector<HTMLDivElement>(".sandbox-status");
if (sandbox) renderEmpty(sandbox);

// Opens over the chat; its previews are drawn there, outside the sandbox.
const componentsPanel = createCustomComponentsPanel();
app.querySelector(".chat-body")?.append(componentsPanel.element);
const componentsToggle = app.querySelector<HTMLButtonElement>(".components-toggle");
componentsToggle?.addEventListener("click", () => {
  componentsToggle.setAttribute("aria-expanded", String(componentsPanel.toggle()));
});

/** Set while a turn streams; aborting it closes the stream. */
let activeTurn: AbortController | null = null;
/** The `id` of the `ui` event that drew the shown design; actions name it. */
let shownUiId: string | null = null;
let shownTree: UiNode | null = null;
let actionInFlight = false;
/** Set while the status area asks an action's confirm question. */
let confirmShown = false;

/** The thinking indicator while it is in the thread; always the last item. */
let thinkingEl: HTMLElement | null = null;

function appendLine(className: string, text: string, tag = "p"): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  thread?.insertBefore(el, thinkingEl);
  scrollToBottom();
  return el;
}

function showThinking() {
  if (thinkingEl || !thread) return;
  const el = document.createElement("div");
  el.className = `${assistantTurnClass} flex items-center gap-1`;
  const label = document.createElement("span");
  label.className = "sr-only";
  label.textContent = "Thinking…";
  el.appendChild(label);
  for (const delay of ["", "[animation-delay:150ms]", "[animation-delay:300ms]"]) {
    const dot = document.createElement("span");
    dot.setAttribute("aria-hidden", "true");
    dot.className = `h-1.5 w-1.5 rounded-full bg-zinc-400 animate-bounce motion-reduce:animate-none ${delay}`;
    el.appendChild(dot);
  }
  thinkingEl = el;
  thread.appendChild(el);
  scrollToBottom();
}

function hideThinking() {
  thinkingEl?.remove();
  thinkingEl = null;
}

function scrollToBottom() {
  if (thread) thread.scrollTop = thread.scrollHeight;
}

function setStreaming(streaming: boolean) {
  if (submitButton) submitButton.textContent = streaming ? "Stop" : "Send";
  syncActionButtons();
}

/**
 * Action buttons wait out a streaming turn, an action in flight or a confirm
 * question. Buttons the design disables have no `data-action`, so they stay
 * disabled.
 */
function syncActionButtons() {
  const busy = actionInFlight || activeTurn !== null || confirmShown;
  for (const button of sandbox?.querySelectorAll<HTMLButtonElement>("button[data-action]") ?? []) {
    button.disabled = busy;
  }
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

/** The streaming turn's latest agent bubble, if it has one. */
interface TurnView {
  bubble: HTMLElement | null;
}

/** The last item the person sees in the thread, ignoring the thinking indicator. */
function lastVisibleItem(): Element | null {
  return thinkingEl ? thinkingEl.previousElementSibling : (thread?.lastElementChild ?? null);
}

function renderEvent(event: AgentEvent, view: TurnView) {
  if (threadEffect(event) === null) {
    if (event.type === "ui") {
      if (sandbox) renderUi(event.tree, sandbox);
      shownUiId = event.id;
      shownTree = event.tree;
      showStatus(null);
      syncActionButtons();
    }
    return;
  }
  switch (event.type) {
    case "text":
      // Text after a notice or error opens a new bubble, so the thread reads
      // in the order things happened.
      if (!view.bubble || view.bubble !== lastVisibleItem()) {
        view.bubble = appendLine(assistantTurnClass, "", "article");
      }
      view.bubble.textContent += event.text;
      scrollToBottom();
      break;
    case "notice":
      appendLine(systemLineClass, event.message);
      break;
    case "error":
      appendLine(errorLineClass, event.message);
      break;
  }
}

async function sendTurn(message: string) {
  const controller = new AbortController();
  activeTurn = controller;
  // A new turn drops an unanswered confirm question.
  if (confirmShown) showStatus(null);
  setStreaming(true);

  appendLine(userTurnClass, message, "article");
  showThinking();
  const view: TurnView = { bubble: null };
  let thinking = true;

  try {
    await streamChat(
      { conversationId, message },
      (event) => {
        // Text after Stop belongs to an aborted turn.
        if (controller.signal.aborted) return;
        renderEvent(event, view);
        thinking = thinkingAfter(thinking, event);
        if (thinking) showThinking();
        else hideThinking();
      },
      controller.signal,
    );
  } finally {
    if (activeTurn === controller) {
      hideThinking();
      activeTurn = null;
      setStreaming(false);
    }
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

  await postAction({ conversationId, uiId: shownUiId, action, values: actionValues(readFields(controls)) });
}

/** Posts an action request and shows its result, or asks its confirm question. */
async function postAction(request: ActionRunRequest) {
  actionInFlight = true;
  syncActionButtons();
  try {
    const result = await runAction(request);
    // A design drawn meanwhile has already cleared the status area for itself.
    const sameDesign = shownUiId === request.uiId;
    if (result.confirm !== undefined) {
      // Nothing ran; a question for a design or turn the person has left is dropped.
      if (sameDesign && !activeTurn) askConfirm(request, result.confirm);
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
  if (activeTurn) {
    activeTurn.abort();
    activeTurn = null;
    hideThinking();
    setStreaming(false);
    appendLine(systemLineClass, "Stopped.");
    return;
  }
  const text = textarea?.value.trim();
  if (!text || !thread) return;
  if (textarea) textarea.value = "";
  void sendTurn(text);
});

textarea?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    // Enter never starts (or stops) a turn while one is streaming.
    if (!activeTurn) form?.requestSubmit();
  }
});
