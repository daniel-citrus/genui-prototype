/**
 * The client ⇄ server wire contract: the action and custom-component routes
 * the browser calls.
 */

import type { StoredCustomComponent } from "./customComponents";
import type { UiNode } from "./ui";

/** Longest text value an action input may send. */
export const MAX_FIELD_CHARS = 1000;

/** `POST /api/actions/run` request body: a click on a Button with an action. */
export interface ActionRunRequest {
  /** The `id` of the design: from `POST /api/generate`. */
  designId: string;
  action: string;
  /** Named input values; password fields never included. */
  values: Record<string, string | boolean>;
  /** The person said yes to the action's confirm question. */
  confirmed?: boolean;
}

/** What an action reports back; `message` is shown to the person. */
export interface ActionResult {
  ok: boolean;
  message: string;
  /** The action did not run: ask this, then resend with confirmed: true. */
  confirm?: string;
}

/** One entry of `GET /api/custom-components`; `deletedAt` is set for a deleted one. */
export type CustomComponentSummary = Pick<
  StoredCustomComponent,
  "name" | "description" | "category" | "version" | "versions" | "updatedAt" | "deletedAt"
>;

/** `GET /api/custom-components/:name`. */
export interface CustomComponentDetail {
  /** The current version. */
  component: StoredCustomComponent;
  /** Every version, oldest first. */
  versions: { version: number; description: string; createdAt: string }[];
  /** The component with its example props, expanded to catalog components; null when that fails. */
  preview: UiNode | null;
  /** Why `preview` is null. */
  previewErrors: string[];
}
