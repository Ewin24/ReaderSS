/**
 * Bookkeeping for the "something changed, re-fetch" signals `App.tsx` hands
 * to its child containers. Previously three `useState` counters and three
 * inline bump handlers lived directly in `App.tsx`, which was already too
 * close to reviewer-cognitive-load limits, then grew by two more signals
 * and three more handlers anyway -- the exact surface a missed wiring call
 * site produced a critical bug on before. Extracted here, focused on ONLY
 * this bookkeeping (not a wholesale `App.tsx` restructuring).
 *
 * Each version counter tracks a DIFFERENT reason a container needs to
 * re-fetch, bumped from a different call site:
 *
 * - `feedListVersion`: the set of subscribed feeds itself changed (a feed
 *   was added or removed). Drives `App`'s own feed-list reload.
 * - `entryStateVersion`: an entry's read/unread or star/unstar state
 *   changed. Does NOT mean the feed list changed -- kept separate from
 *   `feedListVersion` so a read/unread click never flashes a "Loading your
 *   feeds…" state over the entry list.
 * - `entriesVersion`: a manual refresh pass completed. Drives the currently
 *   selected feed's entry-list reload, since a refresh never itself changes
 *   the selected feed and so would otherwise never re-trigger that effect.
 *
 * `FeedSidebarContainer` needs to react to BOTH `feedListVersion` (a feed
 * was added/removed) and `entryStateVersion` (an unread count changed) --
 * either reason justifies re-fetching its feed list and unread counts.
 * Previously expressed as a bare arithmetic sum
 * (`feedListRefreshSignal + sidebarRefreshSignal`), whose only real
 * correctness argument -- both counters are strictly monotonic, so their
 * sum can never coincidentally repeat across a genuine change -- was
 * implicit and undocumented. `feedSidebarSignal` below exposes
 * both versions as an explicit two-element tuple instead, so a consumer's
 * effect can depend on both values directly and a future third trigger has
 * an unambiguous place to plug into, instead of a fourth counter someone
 * has to remember to fold into the right side of a sum.
 */
import { useCallback, useState } from "preact/hooks";

export interface RefreshSignals {
  readonly feedListVersion: number;
  readonly entryStateVersion: number;
  readonly entriesVersion: number;
  /**
   * `[feedListVersion, entryStateVersion]` -- ready to hand straight to
   * `FeedSidebarContainer`'s `refreshSignal` prop, which needs to re-fetch
   * on either one changing.
   */
  readonly feedSidebarSignal: readonly [feedListVersion: number, entryStateVersion: number];
  /** Call when a feed was added or removed. */
  readonly bumpFeedList: () => void;
  /** Call when an entry's read/unread or star/unstar state changed. */
  readonly bumpEntryState: () => void;
  /** Call when a manual refresh pass completed. */
  readonly bumpEntries: () => void;
}

export function useRefreshSignals(): RefreshSignals {
  const [feedListVersion, setFeedListVersion] = useState(0);
  const [entryStateVersion, setEntryStateVersion] = useState(0);
  const [entriesVersion, setEntriesVersion] = useState(0);

  const bumpFeedList = useCallback(() => setFeedListVersion((current) => current + 1), []);
  const bumpEntryState = useCallback(() => setEntryStateVersion((current) => current + 1), []);
  const bumpEntries = useCallback(() => setEntriesVersion((current) => current + 1), []);

  return {
    feedListVersion,
    entryStateVersion,
    entriesVersion,
    feedSidebarSignal: [feedListVersion, entryStateVersion],
    bumpFeedList,
    bumpEntryState,
    bumpEntries,
  };
}
