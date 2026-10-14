import { isDeepStrictEqual } from "node:util";
import { eq, inArray, sql } from "drizzle-orm";
import type { CatalogComponent } from "shared/components";
import { validateCatalog } from "../../catalog/validate";
import type { Db } from "./client";
import { components, type ComponentRow } from "./schema";

export interface SeedCounts {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
}

/** Thrown when the catalog breaks a rule; nothing has been written. */
export class InvalidCatalogError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`invalid component catalog:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    this.name = "InvalidCatalogError";
    this.problems = problems;
  }
}

/** The stored fields a catalog entry sets, besides `name`. */
function fields(c: CatalogComponent | ComponentRow) {
  return {
    description: c.description,
    category: c.category,
    children: c.children,
    propsSchema: c.propsSchema,
    exampleProps: c.exampleProps,
  };
}

/** Whether a row already holds the entry. jsonb reorders keys, so compare by value. */
function matches(row: ComponentRow, entry: CatalogComponent): boolean {
  return isDeepStrictEqual(fields(row), fields(entry));
}

/**
 * Brings the `components` table in line with `catalog` in one transaction:
 * inserts missing entries, updates changed rows, deletes rows the catalog no
 * longer has, and leaves the rest untouched. Throws `InvalidCatalogError`
 * without writing if the catalog breaks a rule.
 */
export async function seedComponents(
  db: Db,
  catalog: readonly CatalogComponent[],
): Promise<SeedCounts> {
  const problems = validateCatalog(catalog);
  if (problems.length > 0) throw new InvalidCatalogError(problems);

  return db.transaction(async (tx) => {
    // Serialize concurrent seeds (several API replicas starting at once).
    await tx.execute(sql`lock table ${components} in share row exclusive mode`);
    const rows = await tx.select().from(components);
    const byName = new Map(rows.map((row) => [row.name, row]));
    const counts: SeedCounts = { added: 0, updated: 0, removed: 0, unchanged: 0 };

    const toInsert = catalog.filter((entry) => !byName.has(entry.name));
    if (toInsert.length > 0) {
      await tx.insert(components).values(toInsert.map((c) => ({ name: c.name, ...fields(c) })));
      counts.added = toInsert.length;
    }

    for (const entry of catalog) {
      const row = byName.get(entry.name);
      if (!row) continue;
      if (matches(row, entry)) {
        counts.unchanged++;
      } else {
        await tx
          .update(components)
          .set({ ...fields(entry), updatedAt: sql`now()` })
          .where(eq(components.id, row.id));
        counts.updated++;
      }
    }

    const names = new Set(catalog.map((c) => c.name));
    const stale = rows.filter((row) => !names.has(row.name)).map((row) => row.id);
    if (stale.length > 0) {
      await tx.delete(components).where(inArray(components.id, stale));
      counts.removed = stale.length;
    }

    return counts;
  });
}
