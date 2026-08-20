/**
 * Normalizes any thrown/rejected value into a human-readable message.
 * Previously duplicated verbatim in eight files -- `App.tsx`, `EntryListContainer.tsx`,
 * `ReadingPaneContainer.tsx`, `FeedSidebarContainer.tsx`,
 * `RefreshContainer.tsx`, `AddFeedContainer.tsx`, `toggleEntryField.ts`, and
 * `bootstrap.tsx` -- each a separate chance to miss a future change to how
 * errors get normalized (e.g. unwrapping a domain error type, redacting a
 * field). Lives in `domain/` (design.md §1's dependency-free innermost
 * layer, importable from every other layer without violating the one-way
 * `import-x/no-restricted-paths` zones) rather than nearer any one caller.
 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
