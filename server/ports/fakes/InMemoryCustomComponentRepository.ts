import type { CustomComponentDefinition, StoredCustomComponent } from "shared/customComponents";
import {
  assertCanAddVersion,
  assertCanCreate,
  type CustomComponentRepository,
} from "../CustomComponentRepository";

interface Entry {
  name: string;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Index `n` holds version `n + 1`. */
  versions: { definition: CustomComponentDefinition; createdAt: string }[];
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function toStored(entry: Entry, version: number): StoredCustomComponent {
  return {
    ...structuredClone(entry.versions[version - 1].definition),
    version,
    versions: entry.versions.length,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    deletedAt: entry.deletedAt,
  };
}

/** A `CustomComponentRepository` in memory, for tests. Same rules as the Drizzle one. */
export class InMemoryCustomComponentRepository implements CustomComponentRepository {
  private readonly entries = new Map<string, Entry>();

  async list(
    opts: { includeDeleted?: boolean; search?: string; limit?: number } = {},
  ): Promise<{ components: StoredCustomComponent[]; total: number }> {
    const search = opts.search?.toLowerCase() ?? "";
    const matches = [...this.entries.values()]
      .filter(
        (e) =>
          (opts.includeDeleted || e.deletedAt === null) &&
          (e.name.toLowerCase().includes(search) ||
            e.versions[e.currentVersion - 1].definition.description.toLowerCase().includes(search)),
      )
      .sort((a, b) => compare(a.name, b.name));
    return {
      components: matches.slice(0, opts.limit).map((e) => toStored(e, e.currentVersion)),
      total: matches.length,
    };
  }

  async getByName(name: string): Promise<StoredCustomComponent | undefined> {
    const entry = this.find(name);
    return entry && toStored(entry, entry.currentVersion);
  }

  async getVersion(name: string, version: number): Promise<StoredCustomComponent | undefined> {
    const entry = this.find(name);
    return entry?.versions[version - 1] && toStored(entry, version);
  }

  async listVersions(
    name: string,
  ): Promise<{ version: number; description: string; createdAt: string }[]> {
    return (this.find(name)?.versions ?? []).map((v, i) => ({
      version: i + 1,
      description: v.definition.description,
      createdAt: v.createdAt,
    }));
  }

  async save(definition: CustomComponentDefinition): Promise<StoredCustomComponent> {
    const key = definition.name.toLowerCase();
    const now = new Date().toISOString();
    let entry = this.entries.get(key);
    if (entry) {
      assertCanAddVersion(definition.name, {
        name: entry.name,
        deleted: entry.deletedAt !== null,
        versions: entry.versions.length,
      });
    } else {
      const all = [...this.entries.values()];
      assertCanCreate({
        notDeleted: all.filter((e) => e.deletedAt === null).length,
        total: all.length,
      });
      entry = {
        name: definition.name,
        currentVersion: 0,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        versions: [],
      };
      this.entries.set(key, entry);
    }
    entry.versions.push({ definition: structuredClone(definition), createdAt: now });
    entry.currentVersion = entry.versions.length;
    entry.updatedAt = now;
    return toStored(entry, entry.currentVersion);
  }

  async softDelete(name: string): Promise<boolean> {
    const entry = this.find(name);
    if (entry) entry.deletedAt ??= new Date().toISOString();
    return entry !== undefined;
  }

  async restore(name: string): Promise<boolean> {
    const entry = this.find(name);
    if (entry) entry.deletedAt = null;
    return entry !== undefined;
  }

  /** The entry stored under exactly `name`. */
  private find(name: string): Entry | undefined {
    const entry = this.entries.get(name.toLowerCase());
    return entry?.name === name ? entry : undefined;
  }
}
