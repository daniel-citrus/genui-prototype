# Reliable custom component generation

> **Merged** on 2026-10-23 into [Reliable component generation: lists, charts and per-item forms](../plans/data-driven-components-and-card-forms.md), which carries its items as R11–R13, R9 and R16. Kept for history; don't plan from this file.

**Branch:** guardrails · **Written:** 2026-10-23

Brief handoff for Grok to expand into a full implementation plan. No implementation is included.

## Goal

The chat agent should recognize when a requested UI needs a custom component, create it using supported syntax, recover from validation errors, and show the result. Users should not have to say “define a custom component” or name internal tools.

Keep the existing single-agent architecture, component storage, and rendering pipeline. Custom components remain JSON templates with restricted Markup; adding JavaScript behavior or new backend actions is outside this change.

## Recommended decision flow

1. Identify the requested content, appearance, and interactions. Ask a question only when a missing detail materially changes the design.
2. Discover relevant components and, when an interaction needs the server, registered actions.
3. Check whether existing components actually satisfy the requirements. Prefer reuse when they do; a rough visual approximation is not sufficient when the user requested something specific.
4. For unmet visual requirements, define the smallest useful custom component. Compose existing components where sufficient; use Markup for the missing visual capability. A one-off visual need is a valid reason to create one.
5. Validate, repair reported problems, and retry within the existing turn limits.
6. Render the complete design, then briefly explain the result or any remaining limitation. Requests only to save a component or answer a question do not require a render.

A missing backend action must not be treated as a reason to invent behavior through Markup. Preserve the existing fallback: show the supported UI and explain which interaction is unavailable.

## Changes to plan

### 1. Fix retries after component changes

**Confirmed bug:** `server/agent/loop.ts` deduplicates every tool call by name and arguments, including failed calls. Fixing a component does not allow the same render arguments to run again.

Minimal reproduction using the real tools:

- Save a component whose optional `title` prop fills the required text of a Heading; provide a valid title in its example props.
- Render an instance with no title. Validation correctly fails.
- Update the component to give `title` a default.
- Retry the identical render. The loop rejects it as a duplicate, although calling the renderer directly now succeeds.

Allow reads and renders to run again after repairs. Preserve protection against repeating successful writes and creating unnecessary component versions. Prefer removing blanket deduplication over adding a complicated cache invalidation system. Keep the existing tool, step, and token limits.

Start with `server/agent/loop.ts`, `server/agent/guardrails.ts`, `server/agent/run.ts`, and `server/agent/loop.test.ts`.

### 2. Make Markup constraints discoverable

`get_component("Markup")` describes allowlisted HTML/CSS without returning the actual allowlists. A saved StatusDot evaluation needed three definition attempts because of unsupported `inline-flex` and an invalid `attrs.style`; replaying those attempts against current code reproduced the errors.

Return supported tags, attributes, styles, constrained values, and relevant limits through the existing component discovery tools. Derive the information from the same constants used by validation. Include a small valid example and the prop-binding syntax. Keep the response within the existing tool-result size cap.

Start with `shared/markup.ts`, `shared/customComponents.ts`, `server/catalog/components.ts`, and `server/agent/tools/components.ts`. Preserve the sanitizer and its restrictions.

### 3. Clarify when to generate a component

Update `server/agent/systemPrompt.ts` around the decision sequence above. Replace the ambiguous “nothing existing can draw” threshold with whether existing components satisfy the requested visual requirements. Preserve reuse preferences and avoid unnecessary custom wrappers for ordinary layouts.

This is a likely contributor to missed generation, not a confirmed diagnosis of the user's exact failing prompt. Add behavioral evaluations rather than relying on prompt wording assertions alone.

Coordinate with the separate `plain-chat-and-new-chat.md` plan, which also changes reply instructions in this file.

### 4. Make validation recovery bounded and explicit

Today, any model response without tool calls ends the turn, including immediately after failed generation. Recovery depends entirely on prompt compliance.

Expose structured success/failure information to the loop and distinguish validation errors from unavailable services or other terminal failures. Give unresolved construction errors a bounded opportunity for repair within the existing budgets. If work remains incomplete, report that clearly instead of treating the turn as successfully completed.

Account for streamed text: a response promising to retry or claiming success should not reach the user before the loop decides whether to continue. Preserve valid questions, save-only requests, ordinary text answers, and Stop behavior. Record the actual stopping reason in traces.

Start with `shared/api.ts`, `server/agent/run.ts`, `server/agent/loop.ts`, `server/agent/trace.ts`, and the construction tool handlers. Grok should choose the smallest state and interface changes needed.

### 5. Test autonomous selection and recovery

The current custom-generation evals explicitly instruct the model to define a component. Add ordinary user requests that require the agent to make that decision itself.

- Positive cases: a revenue bar chart and a specifically styled rating display, without naming tools or custom components.
- Negative cases: an ordinary heading, alert, or form that existing components already cover.
- Reuse case: a fitting custom component already exists; use it without saving a duplicate.
- Deterministic regressions: the retry reproduction above, repeated successful writes, validation repair, exhausted budgets, and cancellation.

Check both successful generation and successful rendering; avoid requiring a particular generated component name. Use manual visual review where structural checks cannot establish that the requested appearance was achieved.

Start with `server/eval/cases`, `server/eval/checks.ts`, `server/eval/runner.ts`, and the agent/tool tests. Extend the eval format only where necessary for seeded components or meaningful assertions.

## Acceptance and validation

- A supported visual need can trigger custom generation without an explicit instruction to create a component.
- Existing components are reused when they satisfy the request.
- Fixing a component permits the same render to succeed in the same turn.
- Repeated successful writes do not create accidental extra versions.
- Markup discovery describes what the validator accepts; validation remains authoritative.
- Repair attempts respect current limits, and unfinished work is reported accurately.
- Run the existing checks: `npm run typecheck`, `npm test`, `npm run build`, and `npm run build:api`. Unit tests use fakes; database and Redis tests need their services when configured.
- With credentials available, compare repeated live eval runs using `npm run eval -- --repeat 3` and inspect representative rendered results.

The initial review passed 107 focused tests and reproduced the retry bug with an additional temporary harness. That coverage did not prove autonomous component selection. Convert the reproduction into a committed regression test during implementation.

## Handoff notes

Suggested order: fix retry semantics and expose Markup constraints; update the decision policy and recovery behavior; expand evaluations and verify the full flow. Keep changes small enough to review independently.

Do not raise budgets, loosen Markup restrictions, add another agent, or redesign persistence as a first response. Grok should flesh out the exact retry bookkeeping, bounded recovery policy, and evaluation assertions. No unresolved product decision is needed to start that planning.

See [architecture](../../docs/ARCHITECTURE.md), [agent loop](../../server/agent/loop.ts), [system prompt](../../server/agent/systemPrompt.ts), and the separate [plain chat plan](../plans/plain-chat-and-new-chat.md).
