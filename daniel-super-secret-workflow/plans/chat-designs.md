# Designs in the chat, and used forms that look used

## Overview

The preview page has two columns today (`src/main.ts`). The left one holds the prompt box and the notes. The right one holds the latest design in a sandbox, with an action status line above it. After an action succeeds, the design stays fully clickable, so nothing tells the person the form has already done its job. This change makes the page a single chat column and makes a used form look finished.

Each prompt appears in the transcript. Under it comes the generated design with its notes directly below, or an error. The composer moves to the bottom. Only the newest design is live: a newer design disables the older ones and labels them as replaced. When an action succeeds, a friendly reply ("Done!" plus the action's own message) appears under that design's notes, and the used form is disabled and marked Done. A failed result, a hidden-field refusal, or Cancel on a confirm question leaves the form usable so the person can fix it and retry.

A success locks the clicked button's Card, or the whole design when the button has no Card. It locks the whole design instead when the action made another Card stale. Stale means one of that Card's dropdowns can now send a value its source no longer has, for example a category that was just renamed. Only the API can see that, so a successful `POST /api/actions/run` answer gains an optional `stale` list, and the page decides the lock from it.

The API slice lands first, then the chat slice reads `stale`. Request bodies don't change and `stale` is optional, so a host agent is unaffected. The lock exists only in the page: the API still runs a repeated request. Nothing is saved in the browser, and a reload still clears the transcript. Text inputs don't count toward staleness. Risks: designs in one page now share tree paths, so every field lookup must stay inside its own design. Each success also lists the bound dropdown sources once, which is cheap on today's in-memory menu.

## Shared

A successful `ActionResult` (`shared/api.ts`) may carry `stale?: string[]`. Each entry names a scope that has a dropdown which can now send a value its source no longer offers. A Card is named by its tree path (`"tree.children.1"`, the form `nearestCard` in `shared/formScope.ts` returns). `"tree"` stands for dropdowns outside every Card. An answer with `ok: false`, including a confirm question, never carries `stale`, and a missing `stale` means none. The page applies one lock rule. When the clicked button has a nearest Card and `stale` names nothing other than that Card, only that Card locks. Otherwise the whole design locks. Only `ok: true` locks anything.

## Work breakdown

| Slice | Covers | Touches | After | Size |
| --- | --- | --- | --- | --- |
| stale-scopes | `stale` on action answers | shared/api.ts, server/routes/actions.ts, server/routes/actions.test.ts, server/ui/bindings.ts, server/ui/bindings.test.ts, server/ui/staleScopes.ts, server/ui/staleScopes.test.ts, README.md, docs/ARCHITECTURE.md | - | medium |
| chat | single-column chat with used-form locks | src/main.ts, src/chat.ts, src/lockScope.ts, src/lockScope.test.ts, src/sandbox/render.ts, src/sandbox/components.ts, README.md, docs/ARCHITECTURE.md | stale-scopes | large |

## stale-scopes

After an action runs with `ok: true`, the actions route (`server/routes/actions.ts`) works out which scopes of the stored design are stale and adds them as `stale`. A Select is bound to a source when an enabled action button that sends it (`sendsInput`) names its `name` in that action spec's `choices`. Each bound source is listed once through `ActionRegistry.listChoices` after the run. A Select is stale when a value it can send is missing from the fresh list. A disabled Select can send only its preset `value`. An enabled one can send any non-empty option. A Markup `select` counts all of its options. Its scope is its nearest Card, or `"tree"`. If a source fails to list, every scope bound to it counts as stale, and the action's own result is still returned. Put the check in a new `server/ui/staleScopes.ts` that takes the tree, the specs and a lister, so it can be tested without the route. `collectBindings` gains a Select's preset `value` and its `disabled` flag. Document the field where README.md and docs/ARCHITECTURE.md §3 describe the `/api/actions/run` answer.

- With one Card per item, each holding a disabled Select preset to its item and a `menu_update_item` button, renaming item A answers `stale` with only A's Card.
- A create-category form next to a rename-category form with an enabled category Select: creating a category answers `stale: []`.
- Renaming category "Tea" while another Card's enabled Select still offers "Tea" answers `stale` including that other Card.
- A failed action, a confirm question, a 400 refusal and a 409 carry no `stale`.
- When a source fails to list, the action still answers `ok: true` with its message, and the scopes bound to that source are in `stale`.
- Values are still never logged. `npm run typecheck`, `npm test` and `npm run build:api` pass.

## chat

The page becomes one column: a header with the title and the Components button, a scrolling transcript, and the composer pinned at the bottom. Enter still sends, Shift+Enter still adds a new line, and the 4000-character limit stays. The sandbox section and its status area go away. The Components panel still opens over the transcript.

Sending a prompt clears the box, adds the person's message (as text only) and a reply showing "Generating…". That reply becomes the design with its notes directly below, or the red error. The transcript scrolls to the newest entry, and the empty transcript shows "Designs you ask for appear here." A new design disables every control in the older ones, drops an unanswered confirm question, and labels each older design "Replaced by a newer design." If an older design's action was already in flight, its result still shows under that design.

Each design's result and confirm question show in its own entry, below its notes. Reading fields, the hidden-field check and browser validation look only inside that design's own element, because several designs now share tree paths. On `ok: true` the reply is green: "Done!" followed by the action's message. The lock then follows the rule in Shared, decided by a pure `lockScope(tree, buttonPath, stale)` in the new `src/lockScope.ts` that returns a Card path or `"tree"`. Locked controls are disabled and dimmed and lose `data-action`, so `syncActionButtons` never turns them back on. A locked Card shows a Done badge, and a fully locked design shows a Done label. The Card renderer may mark its element with its tree path so the page can find it. When only a Card locked and the design still has live Cards, the reply adds "The other forms here still work." When the whole design locked because another Card went stale, it adds "The other forms here are out of date now, so ask again for a fresh one." A failure shows its message in red and leaves the form usable. A later success in the same design replaces that reply. The transcript code may move into a new `src/chat.ts`. Update the layout diagram and bullets in docs/ARCHITECTURE.md §2, and the README sentence about where designs and notes appear.

- The page has a single column. No Sandbox section or separate status area is left, and each design sits under the prompt that asked for it, with its notes directly below.
- After a second design arrives, the first one's controls are disabled and it reads "Replaced by a newer design." Clicking its buttons sends no request.
- A successful action shows the green "Done!" reply under that design's notes and marks the used part Done. Clicking its button again sends no request.
- In a design with one Card per item, saving one Card locks only that Card, the reply says the other forms still work, and another Card's button still sends.
- When `stale` names another Card, the whole design locks and the reply says to ask again for a fresh one.
- A failed result shows in red and the form stays usable. Correcting the field and clicking again sends a new request.
- A confirm question appears under its design. Cancel leaves the form usable, and Yes followed by success locks it.
- With two designs on the page, clicking the newest one's button sends only its own fields, never a value typed into the older design.
- `src/lockScope.test.ts` covers: no Card gives `"tree"`; an empty or missing `stale` gives the Card; a `stale` that holds only the clicked Card gives the Card; another Card or `"tree"` in `stale` gives `"tree"`.
- `npm run typecheck`, `npm test` and `npm run build` pass.

## After merge

- With `OPENAI_API_KEY` set, "Show each menu item in its own card with a form to rename it", then renaming one item, locks only that Card, and another Card still renames.
- With `OPENAI_API_KEY` set, "Show a form to rename a category and a form to delete a category", then renaming a category the delete form lists, locks the whole design with the out-of-date reply.
