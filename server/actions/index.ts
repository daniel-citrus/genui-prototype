import { demoEchoAction } from "./demo";
import type { ActionDefinition } from "./types";

/** Every action a click can run. */
export function createActions(): ActionDefinition[] {
  return [demoEchoAction];
}
