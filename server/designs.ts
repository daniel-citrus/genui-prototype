import type { UiNode } from "shared/ui";

/** Designs kept in memory, newest last. Restart = designs forgotten. */
export interface DesignStore {
  /** Keeps `tree` under `id`; past the store's `max`, the oldest design is dropped. */
  remember(id: string, tree: UiNode): void;
  /** The design under `id`, or `undefined` if unknown or dropped. */
  get(id: string): UiNode | undefined;
}

export function createDesignStore(opts: { max: number }): DesignStore {
  /** Oldest first (Map insertion order). */
  const designs = new Map<string, UiNode>();
  return {
    remember(id, tree) {
      designs.delete(id);
      designs.set(id, tree);
      if (designs.size > opts.max) {
        const [oldest] = designs.keys();
        designs.delete(oldest);
      }
    },
    get: (id) => designs.get(id),
  };
}
