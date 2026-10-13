import "./style.css";
import type { AgentEvent } from "shared/api";
import { streamChat } from "./agentClient";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app missing");

const userTurnClass =
  "self-end max-w-[85%] rounded-2xl rounded-br-md bg-sky-600 px-4 py-2.5 text-sm leading-snug text-white shadow-sm";
const assistantTurnClass =
  "self-start max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-zinc-100 px-4 py-2.5 text-sm leading-snug text-zinc-900 shadow-sm";
const systemLineClass = "self-start px-1 text-xs text-zinc-500";
const errorLineClass = "self-start rounded-md bg-red-50 px-2 py-1 text-xs text-red-700";
const toolLineClass = "self-start px-1 font-mono text-xs text-zinc-500";

/** One conversation per page load; the server keeps its history. */
const conversationId = crypto.randomUUID();

app.innerHTML = `
  <div class="grid h-full min-h-0 grid-cols-2 bg-zinc-50 text-zinc-900">
    <section class="flex min-h-0 min-w-0 flex-col border-r border-zinc-200 bg-white" aria-label="Agent chat">
      <header class="shrink-0 border-b border-zinc-200 px-4 py-3">
        <label class="sr-only" for="session-select">Session</label>
        <select
          id="session-select"
          aria-label="Session"
          class="w-full max-w-xs rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 shadow-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
        ></select>
      </header>
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
    </section>
    <section class="flex min-h-0 min-w-0 flex-col bg-zinc-100/80 p-4" aria-label="Sandbox">
      <div class="min-h-0 flex-1 rounded-xl border border-dashed border-zinc-300 bg-white shadow-inner"></div>
    </section>
  </div>
`;

const form = app.querySelector<HTMLFormElement>(".composer");
const textarea = app.querySelector<HTMLTextAreaElement>('textarea[name="message"]');
const thread = app.querySelector<HTMLDivElement>(".thread");
const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');

/** Set while a turn streams; aborting it closes the stream. */
let activeTurn: AbortController | null = null;

function appendLine(className: string, text: string, tag = "p"): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  thread?.appendChild(el);
  scrollToBottom();
  return el;
}

function scrollToBottom() {
  if (thread) thread.scrollTop = thread.scrollHeight;
}

function setStreaming(streaming: boolean) {
  if (submitButton) submitButton.textContent = streaming ? "Stop" : "Send";
}

function renderEvent(event: AgentEvent, bubble: HTMLElement) {
  switch (event.type) {
    case "text":
      bubble.textContent += event.text;
      scrollToBottom();
      break;
    case "tool_call":
      appendLine(toolLineClass, `→ ${event.call.name}`);
      break;
    case "tool_result":
      appendLine(
        event.result.ok ? toolLineClass : errorLineClass,
        `${event.result.ok ? "✓" : "✗"} ${event.call.name}: ${event.result.summary}`,
      );
      break;
    case "notice":
      appendLine(systemLineClass, event.message);
      break;
    case "error":
      appendLine(errorLineClass, event.message);
      break;
    case "done":
      break;
  }
}

async function sendTurn(message: string) {
  const controller = new AbortController();
  activeTurn = controller;
  setStreaming(true);

  appendLine(userTurnClass, message, "article");
  const bubble = appendLine(assistantTurnClass, "", "article");

  try {
    await streamChat(
      { conversationId, message },
      (event) => {
        // Text after Stop belongs to an aborted turn.
        if (!controller.signal.aborted) renderEvent(event, bubble);
      },
      controller.signal,
    );
  } finally {
    if (!bubble.textContent) bubble.remove();
    if (activeTurn === controller) {
      activeTurn = null;
      setStreaming(false);
    }
  }
}

form?.addEventListener("submit", (e) => {
  e.preventDefault();
  if (activeTurn) {
    activeTurn.abort();
    activeTurn = null;
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
