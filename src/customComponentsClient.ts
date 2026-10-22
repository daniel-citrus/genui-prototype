import type { CustomComponentDetail, CustomComponentSummary } from "shared/api";
import { errorMessage } from "./actionsClient";

/**
 * Sends one request to the custom components route and resolves its parsed
 * body (undefined for 204). Network and HTTP failures throw an Error with the
 * route's message, or a generic one.
 */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/custom-components${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error("Couldn't reach the server.");
  }
  if (response.status === 204) return undefined as T;

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = undefined;
  }
  if (!response.ok) throw new Error(errorMessage(parsed) ?? `Request failed (${response.status})`);
  return parsed as T;
}

const named = (name: string) => `/${encodeURIComponent(name)}`;

export function listCustomComponents(): Promise<{ components: CustomComponentSummary[] }> {
  return request("GET", "");
}

export function getCustomComponent(name: string): Promise<CustomComponentDetail> {
  return request("GET", named(name));
}

export function deleteCustomComponent(name: string): Promise<void> {
  return request("DELETE", named(name));
}

export function restoreCustomComponent(name: string): Promise<void> {
  return request("POST", `${named(name)}/restore`);
}

/** Saves a copy of `version` as the new current version, whose number it resolves. */
export function revertCustomComponent(name: string, version: number): Promise<{ version: number }> {
  return request("POST", `${named(name)}/revert`, { version });
}
