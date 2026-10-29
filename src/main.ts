import "./style.css";
import { MAX_PROMPT_CHARS } from "shared/generate";
import { createChat } from "./chat";
import { createCustomComponentsPanel } from "./customComponentsPanel";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app missing");

app.innerHTML = `
  <div class="flex h-full min-h-0 flex-col bg-zinc-50 text-zinc-900">
    <header class="flex shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-4 py-3">
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
    <div class="chat-body relative min-h-0 flex-1">
      <div class="h-full overflow-y-auto px-4 py-4" role="log" aria-label="Transcript">
        <div class="transcript mx-auto flex max-w-3xl flex-col gap-4"></div>
      </div>
    </div>
    <form class="composer shrink-0 border-t border-zinc-200 bg-white px-4 py-3" aria-label="Generate a design">
      <div class="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          name="prompt"
          rows="2"
          maxlength="${MAX_PROMPT_CHARS}"
          placeholder="Describe the UI you want…"
          aria-label="Prompt"
          class="min-w-0 flex-1 resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm outline-none placeholder:text-zinc-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
        ></textarea>
        <button
          type="submit"
          class="shrink-0 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sky-700 active:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Generate
        </button>
      </div>
    </form>
  </div>
`;

const form = app.querySelector<HTMLFormElement>(".composer");
const textarea = app.querySelector<HTMLTextAreaElement>('textarea[name="prompt"]');
const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
const transcript = app.querySelector<HTMLDivElement>(".transcript");
if (!transcript) throw new Error(".transcript missing");
const chat = createChat(transcript);

// Opens over the transcript; its previews are drawn there, outside every design.
const componentsPanel = createCustomComponentsPanel();
app.querySelector(".chat-body")?.append(componentsPanel.element);
const componentsToggle = app.querySelector<HTMLButtonElement>(".components-toggle");
componentsToggle?.addEventListener("click", () => {
  componentsToggle.setAttribute("aria-expanded", String(componentsPanel.toggle()));
});

form?.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = textarea?.value.trim();
  if (!textarea || !text || chat.generating) return;
  textarea.value = "";
  if (submitButton) submitButton.disabled = true;
  void chat.send(text).finally(() => {
    if (submitButton) submitButton.disabled = false;
  });
});

textarea?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form?.requestSubmit();
  }
});
