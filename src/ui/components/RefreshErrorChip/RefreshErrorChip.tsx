export interface RefreshErrorChipProps {
  feedTitle: string;
  errorMessage: string;
}

/**
 * Per-feed refresh failure: visible, never silent, isolated from other
 * feeds' failures. `role="alert"` makes each
 * chip announce itself immediately -- distinct from the future
 * OfflineBanner, which represents an already-known, passive connectivity
 * state and is
 * expected to use `role="status"` instead. `errorMessage` is passed through
 * as-is from `FeedRefreshOutcome.errorMessage` (`services/refreshFeeds.ts`),
 * which is already the specific, human-readable message the relay or the
 * client-side fetch adapter produced -- this component does not re-derive
 * or generalize it.
 */
export function RefreshErrorChip({ feedTitle, errorMessage }: RefreshErrorChipProps) {
  return (
    <p class="refresh-error-chip" role="alert">
      <strong class="refresh-error-chip__feed">{feedTitle}</strong>
      <span class="refresh-error-chip__message">{errorMessage}</span>
    </p>
  );
}
