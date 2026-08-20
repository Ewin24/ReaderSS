import type { Entry } from "./Entry";

/**
 * The syncable subset of an Entry: only the fields that participate in the
 * GitHub `state.json` merge. Kept as its own model so the
 * merge layer never has to know about content fields.
 */
export interface EntryState {
  entryId: string;
  read: 0 | 1;
  readChangedAt: string | null;
  starred: 0 | 1;
  starredChangedAt: string | null;
}

export interface CreateEntryStateInput {
  entryId: string;
  read?: 0 | 1;
  readChangedAt?: string | null;
  starred?: 0 | 1;
  starredChangedAt?: string | null;
}

export function createEntryState(input: CreateEntryStateInput): EntryState {
  return {
    entryId: input.entryId,
    read: input.read ?? 0,
    readChangedAt: input.readChangedAt ?? null,
    starred: input.starred ?? 0,
    starredChangedAt: input.starredChangedAt ?? null,
  };
}

export function toEntryState(entry: Entry): EntryState {
  return {
    entryId: entry.id,
    read: entry.read,
    readChangedAt: entry.readChangedAt,
    starred: entry.starred,
    starredChangedAt: entry.starredChangedAt,
  };
}
