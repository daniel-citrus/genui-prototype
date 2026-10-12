import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app missing");

const userTurnClass =
  "self-end max-w-[85%] rounded-2xl rounded-br-md bg-sky-600 px-4 py-2.5 text-sm leading-snug text-white shadow-sm";

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

form?.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = textarea?.value.trim();
  if (!text || !thread) return;
  const turn = document.createElement("article");
  turn.className = userTurnClass;
  turn.textContent = text;
  thread.appendChild(turn);
  thread.scrollTop = thread.scrollHeight;
  if (textarea) textarea.value = "";
});

textarea?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form?.requestSubmit();
  }
});
