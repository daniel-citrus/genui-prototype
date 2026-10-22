import { and, count, eq, isNull, or, sql, type Column, type SQL } from "drizzle-orm";
import type { CustomComponentDefinition, StoredCustomComponent } from "shared/customComponents";
import {
  assertCanAddVersion,
  assertCanCreate,
  CustomComponentError,
  type CustomComponentRepository,
} from "../../ports/CustomComponentRepository";
import type { Db } from "./client";
import {
  customComponents,
  customComponentVersions,
  type CustomComponentRow,
  type CustomComponentVersionRow,
} from "./schema";

/** The largest Postgres `integer`. */
const MAX_PG_INTEGER = 2_147_483_647;

function toStored(
  component: CustomComponentRow,
  version: CustomComponentVersionRow,
  versions: number,
): StoredCustomComponent {
  return {
    name: component.name,
    description: version.description,
    category: version.category,
    children: version.children,
    propsSchema: version.propsSchema,
    exampleProps: version.exampleProps,
    template: version.template,
    version: version.version,
    versions,
    createdAt: component.createdAt.toISOString(),
    updatedAt: component.updatedAt.toISOString(),
    deletedAt: component.deletedAt?.toISOString() ?? null,
  };
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  return e.code === "23505" || e.cause?.code === "23505";
}

const containsIgnoringCase = (column: Column, search: string) =>
  sql`strpos(lower(${column}), lower(${search})) > 0`;
const isCurrentVersion = eq(customComponentVersions.version, customComponents.currentVersion);
// Byte order, so the order doesn't depend on the database's collation.
const byName = sql`${customComponents.name} collate "C"`;

export class DrizzleCustomComponentRepository implements CustomComponentRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async list(
    opts: { includeDeleted?: boolean; search?: string; limit?: number } = {},
  ): Promise<{ components: StoredCustomComponent[]; total: number }> {
    const where = and(
      opts.includeDeleted ? undefined : isNull(customComponents.deletedAt),
      opts.search
        ? or(
            containsIgnoringCase(customComponents.name, opts.search),
            containsIgnoringCase(customComponentVersions.description, opts.search),
          )
        : undefined,
    );
    const matching = this.selectStored(isCurrentVersion).where(where).orderBy(byName).$dynamic();
    const [rows, [{ total }]] = await Promise.all([
      opts.limit === undefined ? matching : matching.limit(opts.limit),
      this.db
        .select({ total: count() })
        .from(customComponents)
        .innerJoin(customComponentVersions, this.versionOf(isCurrentVersion))
        .where(where),
    ]);
    return { components: rows.map((r) => toStored(r.component, r.version, r.versions)), total };
  }

  async getByName(name: string): Promise<StoredCustomComponent | undefined> {
    const [row] = await this.selectStored(isCurrentVersion).where(eq(customComponents.name, name));
    return row && toStored(row.component, row.version, row.versions);
  }

  async getVersion(name: string, version: number): Promise<StoredCustomComponent | undefined> {
    if (!Number.isInteger(version) || version < 1 || version > MAX_PG_INTEGER) return undefined;
    const [row] = await this.selectStored(eq(customComponentVersions.version, version)).where(
      eq(customComponents.name, name),
    );
    return row && toStored(row.component, row.version, row.versions);
  }

  async listVersions(
    name: string,
  ): Promise<{ version: number; description: string; createdAt: string }[]> {
    const rows = await this.db
      .select({
        version: customComponentVersions.version,
        description: customComponentVersions.description,
        createdAt: customComponentVersions.createdAt,
      })
      .from(customComponentVersions)
      .innerJoin(customComponents, eq(customComponentVersions.componentId, customComponents.id))
      .where(eq(customComponents.name, name))
      .orderBy(customComponentVersions.version);
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  async save(definition: CustomComponentDefinition): Promise<StoredCustomComponent> {
    try {
      return await this.db.transaction(async (tx) => {
        let [component] = await tx
          .select()
          .from(customComponents)
          .where(sql`lower(${customComponents.name}) = lower(${definition.name})`)
          .for("update");
        let versions = 0;
        if (component) {
          versions = await tx.$count(
            customComponentVersions,
            eq(customComponentVersions.componentId, component.id),
          );
          assertCanAddVersion(definition.name, {
            name: component.name,
            deleted: component.deletedAt !== null,
            versions,
          });
        } else {
          // Creations take turns, so concurrent ones can't both pass the count limits.
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext('custom_components'))`);
          const [counts] = await tx
            .select({ total: count(), deleted: count(customComponents.deletedAt) })
            .from(customComponents);
          assertCanCreate({ notDeleted: counts.total - counts.deleted, total: counts.total });
          [component] = await tx
            .insert(customComponents)
            .values({ name: definition.name, currentVersion: 1 })
            .returning();
        }

        const [version] = await tx
          .insert(customComponentVersions)
          .values({
            componentId: component.id,
            version: versions + 1,
            description: definition.description,
            category: definition.category,
            children: definition.children,
            propsSchema: definition.propsSchema,
            exampleProps: definition.exampleProps,
            template: definition.template,
          })
          .returning();
        [component] = await tx
          .update(customComponents)
          .set({ currentVersion: version.version, updatedAt: sql`now()` })
          .where(eq(customComponents.id, component.id))
          .returning();
        return toStored(component, version, versions + 1);
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      throw new CustomComponentError(
        "conflict",
        `"${definition.name}" changed while saving, try again.`,
      );
    }
  }

  async softDelete(name: string): Promise<boolean> {
    const rows = await this.db
      .update(customComponents)
      .set({ deletedAt: sql`coalesce(${customComponents.deletedAt}, now())` })
      .where(eq(customComponents.name, name))
      .returning({ id: customComponents.id });
    return rows.length > 0;
  }

  async restore(name: string): Promise<boolean> {
    const rows = await this.db
      .update(customComponents)
      .set({ deletedAt: null })
      .where(eq(customComponents.name, name))
      .returning({ id: customComponents.id });
    return rows.length > 0;
  }

  /** Joins a component to the version `which` picks. */
  private versionOf(which: SQL) {
    return and(eq(customComponentVersions.componentId, customComponents.id), which);
  }

  /** Components with the version `which` picks, and how many versions each has. */
  private selectStored(which: SQL) {
    return this.db
      .select({
        component: customComponents,
        version: customComponentVersions,
        versions: sql<number>`(select count(*)::int from ${customComponentVersions} counted where counted.component_id = ${customComponents.id})`,
      })
      .from(customComponents)
      .innerJoin(customComponentVersions, this.versionOf(which));
  }
}
