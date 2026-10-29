import type { CustomComponentDetail, CustomComponentSummary } from "shared/api";
import {
  deleteCustomComponent,
  getCustomComponent,
  listCustomComponents,
  restoreCustomComponent,
  revertCustomComponent,
} from "./customComponentsClient";
import { el } from "./sandbox/components";
import { renderUi } from "./sandbox/render";

const emptyMessage = "No custom components yet. Ask the agent to save part of a design as a component.";
const hintMessage = "Select a component to preview it.";
const loadingMessage = "Loading components…";

const groupHeadingClass = "px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500";
const entryClass = "flex items-start gap-2 px-4 py-2";
const selectClass = "min-w-0 flex-1 rounded-md px-2 py-1 text-left transition-colors hover:bg-zinc-100 disabled:cursor-wait";
const metaClass = "text-xs text-zinc-600";
const sectionHeadingClass = "mb-2 mt-5 text-sm font-semibold text-zinc-700";
const buttonClass = {
  plain:
    "pressable shrink-0 rounded-md border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-60",
  danger:
    "pressable shrink-0 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60",
};

export interface CustomComponentsPanel {
  element: HTMLElement;
  /** Opens the panel, loading the list, or closes it; returns whether it's now open. */
  toggle(): boolean;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * `focusKey` names the control across rebuilds ("<kind>:<component name>"),
 * so focus can return to its replacement.
 */
function button(label: string, className: string, focusKey: string, onClick: () => void): HTMLButtonElement {
  const node = el("button", className, label);
  node.type = "button";
  node.dataset.focusKey = focusKey;
  node.addEventListener("click", onClick);
  return node;
}

/**
 * The Components panel: lists custom components, previews one, and deletes,
 * restores or reverts it through the route. It never edits a definition.
 */
export function createCustomComponentsPanel(): CustomComponentsPanel {
  const element = el("section", "absolute inset-0 z-10 hidden flex-col bg-white");
  element.id = "components-panel";
  element.setAttribute("aria-label", "Custom components");
  // The same column as the transcript, so each action sits near the component it acts on.
  const column = el("div", "mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col");
  const message = el("p", "mx-4 mt-3 hidden rounded-md bg-red-50 px-2 py-1 text-xs text-red-700");
  message.setAttribute("role", "alert");
  const list = el("div", "max-h-[45%] shrink-0 overflow-y-auto border-b border-zinc-200 pb-2");
  const detail = el("div", "min-h-0 flex-1 overflow-y-auto px-4 py-4");
  column.append(message, list, detail);
  element.append(column);

  let selected: string | null = null;
  /** Counts loads, so an older answer arriving late is dropped. */
  let loads = 0;
  let busy = false;
  /** Set once the list has drawn; until then it shows the loading line. */
  let listed = false;
  /** The focus key of the control a click left, put back after the next rebuild. */
  let refocusKey: string | null = null;

  /** Shows `text`, or hides the message for null; `retry` adds a Try again button. */
  function showError(text: string | null, retry?: () => void) {
    message.replaceChildren(...(text === null ? [] : [text]));
    if (text !== null && retry) {
      message.append(" ", button("Try again", buttonClass.plain, "retry:", retry));
    }
    message.classList.toggle("hidden", text === null);
  }

  /** The panel's own buttons, not the ones drawn in a preview. */
  function controls(): HTMLButtonElement[] {
    return [...element.querySelectorAll("button")].filter((node) => !node.closest(".components-preview"));
  }

  /** Remembers the focused control, so `restoreFocus` can find its replacement after a rebuild. */
  function rememberFocus() {
    const active = document.activeElement;
    refocusKey = active instanceof HTMLElement && element.contains(active) ? (active.dataset.focusKey ?? null) : null;
  }

  /** Focuses the remembered control, or its component's entry when it is gone. Never takes focus from elsewhere. */
  function restoreFocus() {
    const key = refocusKey;
    refocusKey = null;
    const active = document.activeElement;
    if (key === null || (active && active !== document.body && !element.contains(active))) return;
    const name = key.split(":")[1];
    const find = (k: string) => element.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(k)}"]`);
    (find(key) ?? find(`pick:${name}`))?.focus();
  }

  /** Runs one change, then reloads the list and the selected component. Buttons wait meanwhile. */
  async function act(change: () => Promise<unknown>) {
    if (busy) return;
    busy = true;
    rememberFocus();
    showError(null);
    element.setAttribute("aria-busy", "true");
    for (const node of controls()) node.disabled = true;
    try {
      await change();
    } catch (err) {
      showError(messageOf(err));
    } finally {
      busy = false;
    }
    await load();
    element.removeAttribute("aria-busy");
    for (const node of controls()) node.disabled = false;
    restoreFocus();
  }

  function entry(component: CustomComponentSummary): HTMLLIElement {
    const item = el("li", entryClass);
    const pick = button("", selectClass, `pick:${component.name}`, () => {
      selected = component.name;
      rememberFocus();
      showError(null);
      void load().then(restoreFocus);
    });
    if (component.name === selected) {
      pick.classList.add("bg-sky-50");
      pick.setAttribute("aria-current", "true");
    }
    pick.append(
      el("span", "block text-sm font-medium wrap-anywhere text-zinc-900", component.name),
      el("span", "block text-xs text-zinc-600", component.description),
      el("span", `block ${metaClass}`, `v${component.version} · updated ${when(component.updatedAt)}`),
    );
    item.append(pick);
    if (component.deletedAt !== null) {
      item.append(
        button("Restore", buttonClass.plain, `restore:${component.name}`, () =>
          void act(() => restoreCustomComponent(component.name)),
        ),
      );
    }
    return item;
  }

  function renderList(components: CustomComponentSummary[]) {
    if (components.length === 0) {
      list.replaceChildren(el("p", "px-4 py-6 text-center text-sm text-zinc-500", emptyMessage));
      return;
    }
    const group = (entries: CustomComponentSummary[]) => {
      const ul = el("ul", "");
      ul.append(...entries.map(entry));
      return ul;
    };
    const current = components.filter((c) => c.deletedAt === null);
    const deleted = components.filter((c) => c.deletedAt !== null);
    list.replaceChildren(
      ...(current.length > 0 ? [group(current)] : []),
      ...(deleted.length > 0 ? [el("h3", groupHeadingClass, "Deleted"), group(deleted)] : []),
    );
  }

  function renderDetail({ component, versions, preview, previewErrors }: CustomComponentDetail) {
    const { name, version } = component;
    const deleted = component.deletedAt !== null;
    const header = el("div", "flex items-start gap-2");
    const title = el("div", "min-w-0 flex-1");
    title.append(
      el("h2", "text-base font-semibold wrap-anywhere text-zinc-900", name),
      el(
        "p",
        metaClass,
        `Version ${version} of ${component.versions} · ${component.category}${deleted ? " · deleted" : ""}`,
      ),
    );
    // Delete and Restore share a focus key: one replaces the other in the same place.
    header.append(
      title,
      deleted
        ? button("Restore", buttonClass.plain, `state:${name}`, () => void act(() => restoreCustomComponent(name)))
        : button("Delete", buttonClass.danger, `state:${name}`, () => void act(() => deleteCustomComponent(name))),
    );

    // Drawn here, outside the sandbox, and without data-action: preview buttons send nothing.
    const canvas = el("div", "components-preview rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3");
    if (preview) {
      renderUi(preview, canvas);
      for (const node of canvas.querySelectorAll("[data-action]")) node.removeAttribute("data-action");
    } else {
      canvas.append(el("p", "text-xs text-zinc-500", "No preview."));
    }
    const problems = el("ul", "mt-2 list-disc pl-5 text-xs text-red-700");
    problems.append(...previewErrors.map((problem) => el("li", "", problem)));

    const history = el("ul", "divide-y divide-zinc-100");
    for (const v of [...versions].reverse()) {
      const item = el("li", "flex items-start gap-2 py-2");
      const text = el("div", "min-w-0 flex-1");
      text.append(
        el("p", "text-sm text-zinc-900", `v${v.version}${v.version === version ? " (current)" : ""}`),
        el("p", "text-xs text-zinc-600", v.description),
        el("p", metaClass, when(v.createdAt)),
      );
      item.append(text);
      if (v.version !== version) {
        item.append(
          button(`Revert to version ${v.version}`, buttonClass.plain, `revert:${name}:${v.version}`, () =>
            void act(() => revertCustomComponent(name, v.version)),
          ),
        );
      }
      history.append(item);
    }

    detail.replaceChildren(
      header,
      el("p", "mt-2 text-sm text-zinc-700", component.description),
      el("h3", sectionHeadingClass, "Preview"),
      canvas,
      problems,
      el("h3", sectionHeadingClass, "Versions"),
      history,
    );
  }

  /** Reloads the list and, if one is selected, its detail. Failures show in the panel. */
  async function load() {
    const ticket = ++loads;
    if (!listed) list.replaceChildren(el("p", "px-4 py-6 text-center text-sm text-zinc-500", loadingMessage));
    try {
      const { components } = await listCustomComponents();
      if (ticket !== loads) return;
      if (!components.some((c) => c.name === selected)) selected = null;
      renderList(components);
      listed = true;
      if (selected === null) {
        detail.replaceChildren(el("p", "text-sm text-zinc-500", components.length > 0 ? hintMessage : ""));
        return;
      }
      const shown = await getCustomComponent(selected);
      if (ticket === loads) renderDetail(shown);
    } catch (err) {
      if (ticket !== loads) return;
      if (!listed) list.replaceChildren();
      showError(messageOf(err), () => {
        showError(null);
        void load();
      });
    }
  }

  return {
    element,
    toggle() {
      const open = element.classList.contains("hidden");
      element.classList.toggle("hidden", !open);
      element.classList.toggle("flex", open);
      if (open) {
        showError(null);
        void load();
      }
      return open;
    },
  };
}
