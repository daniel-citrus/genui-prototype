import {
  MAX_CUSTOM_COMPONENT_VERSIONS,
  MAX_CUSTOM_COMPONENTS,
  MAX_CUSTOM_COMPONENTS_TOTAL,
  type CustomComponentDefinition,
  type StoredCustomComponent,
} from "shared/customComponents";

export type CustomComponentErrorCode = "limit" | "deleted" | "conflict" | "name_taken" | "not_found";

/** An expected refusal; `message` is written for the agent. */
export class CustomComponentError extends Error {
  readonly code: CustomComponentErrorCode;

  constructor(code: CustomComponentErrorCode, message: string) {
    super(message);
    this.name = "CustomComponentError";
    this.code = code;
  }
}

/**
 * Stores custom component definitions. A save never overwrites: it adds the
 * next version and makes it current. A delete only hides the component.
 */
export interface CustomComponentRepository {
  /**
   * Current versions ordered by name; deleted ones only with includeDeleted;
   * search is a case-insensitive substring of name or description; total
   * counts all matches before limit.
   */
  list(opts?: {
    includeDeleted?: boolean;
    search?: string;
    limit?: number;
  }): Promise<{ components: StoredCustomComponent[]; total: number }>;
  /** Current version by exact name, deleted included (deletedAt set). */
  getByName(name: string): Promise<StoredCustomComponent | undefined>;
  /** That version by exact name, deleted included; `version` is the one asked for. */
  getVersion(name: string, version: number): Promise<StoredCustomComponent | undefined>;
  /** Every version by exact name, oldest first; empty for an unknown name. */
  listVersions(name: string): Promise<{ version: number; description: string; createdAt: string }[]>;
  /**
   * Saves version 1, or the next version as current. Rejects
   * CustomComponentError limit, deleted, conflict or name_taken.
   */
  save(definition: CustomComponentDefinition): Promise<StoredCustomComponent>;
  /** Resolve false for an unknown name. */
  softDelete(name: string): Promise<boolean>;
  restore(name: string): Promise<boolean>;
}

/**
 * Throws the refusal for saving `name` over `existing`, the stored component
 * with the same name ignoring case, when it may not get another version.
 */
export function assertCanAddVersion(
  name: string,
  existing: { name: string; deleted: boolean; versions: number },
): void {
  if (existing.name !== name) {
    throw new CustomComponentError(
      "name_taken",
      `"${existing.name}" already exists and names are unique ignoring case: save as "${existing.name}" to change it, or pick another name.`,
    );
  }
  if (existing.deleted) {
    throw new CustomComponentError(
      "deleted",
      `"${name}" is deleted: restore it first, or pick another name.`,
    );
  }
  if (existing.versions >= MAX_CUSTOM_COMPONENT_VERSIONS) {
    throw new CustomComponentError(
      "limit",
      `"${name}" already has the limit of ${MAX_CUSTOM_COMPONENT_VERSIONS} versions.`,
    );
  }
}

/** Throws the refusal when one more component would pass a count limit. */
export function assertCanCreate(counts: { notDeleted: number; total: number }): void {
  if (counts.notDeleted >= MAX_CUSTOM_COMPONENTS) {
    throw new CustomComponentError(
      "limit",
      `There are already ${MAX_CUSTOM_COMPONENTS} custom components, the limit: delete one first.`,
    );
  }
  if (counts.total >= MAX_CUSTOM_COMPONENTS_TOTAL) {
    throw new CustomComponentError(
      "limit",
      `There are already ${MAX_CUSTOM_COMPONENTS_TOTAL} custom components counting deleted ones, the limit: update an existing one instead.`,
    );
  }
}
