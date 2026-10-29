# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Developers building genui and the planned CapheViet POS agent. They type prompts into the preview page, check the generated design and its notes, click its buttons to run actions, and manage saved custom components.
- Café staff, the eventual audience. The host agent will show them generated designs (forms, menus, confirmations) to act on. The preview page's rendered designs stand in for what they will see.

Use is phone first; desktop must work too.

## Product Purpose

genui turns a plain-language prompt into a validated UI design (a JSON tree drawn from a fixed component catalog plus saved custom components) with short notes for the person. The preview page draws that design in a sandbox and runs the registered actions its buttons name. Success: a person gets a usable, correct design for their prompt, and its actions do what the buttons say.

## Positioning

Designs are checked against a component catalog, the registered actions and saved custom components before anyone sees them, and actions run without a model call.

## Operating Context

- A chat-style transcript: each prompt, then its design, notes and action replies. Only the newest design is live; older ones are marked replaced.
- A Components panel lists saved custom components, previews one, and deletes, restores or reverts versions.
- Actions run on a demo café menu held in memory. Nothing reaches a real POS.

## Capabilities and Constraints

- Prototype: no authentication.
- Prompts are at most 4000 characters; a generation is cut off after 90 seconds and may take up to three model calls.
- Generating needs `OPENAI_API_KEY`; without it the page runs and generating answers with an error.
- Rendered text always goes in as text, never HTML; Markup elements are filtered to an allowlist.

## Evidence on Hand

No brand assets, logo, testimonials or customer data exist. Do not invent them.

## Product Principles

- The person always knows what state a design is in: generating, live, done, replaced or failed.
- A button never sends a value the person could not see.
- Generated designs must be usable on a phone.

## Accessibility & Inclusion

WCAG 2.2 AA for the preview page and for every rendered catalog component.
