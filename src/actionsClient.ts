import type { ActionResult, ActionRunRequest } from "shared/api";

/**
 * Posts one action click. Network and HTTP failures resolve to
 * `{ ok: false, message }` so the caller always has something to show.
 */
export async function runAction(req: ActionRunRequest, signal?: AbortSignal): Promise<ActionResult> {
  let response: Response;
  try {
    response = await fetch("/api/actions/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      signal,
    });
  } catch {
    return { ok: false, message: "Couldn't reach the server." };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (response.ok && isActionResult(body)) return body;
  return { ok: false, message: errorMessage(body) ?? `Request failed (${response.status})` };
}

function isActionResult(body: unknown): body is ActionResult {
  const result = body as Partial<ActionResult> | null | undefined;
  return typeof result?.ok === "boolean" && typeof result.message === "string";
}

/** `{ error: { message } }` from the API, or `{ message }` from the rate limiter. */
export function errorMessage(body: unknown): string | undefined {
  const b = body as { error?: { message?: unknown }; message?: unknown } | null | undefined;
  const message = b?.error?.message ?? b?.message;
  return typeof message === "string" && message ? message : undefined;
}
