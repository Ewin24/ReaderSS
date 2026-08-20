/**
 * Refresh control invoking the real `refreshFeeds` service (design.md §1
 * names `RefreshContainer`). `Services` is structurally a
 * `RefreshFeedsDeps`, so it is passed straight through, the same pattern
 * every other container uses.
 *
 * Per-feed failures render through the existing `RefreshErrorChip` -- ONE
 * chip per failed feed, never one aggregated message (feed-fetching spec
 * "Per-feed error isolation", "Partial refresh failure"). A failed
 * outcome's `FeedRefreshOutcome` carries only the `feedId`, not the feed's
 * title, so each failing feed's title is looked up with a targeted
 * `getFeed` call after the batch settles, rather than loading every feed up
 * front only to discard the successful ones.
 */
import { useCallback, useState } from "preact/hooks";
import { useServices } from "../../app/providers/ServicesContext";
import { refreshFeeds } from "../../services/refreshFeeds";
import { describeError } from "../../domain/errors/describeError";
import { RefreshErrorChip } from "../components/RefreshErrorChip";

export interface RefreshContainerProps {
  /** Called after a refresh pass completes, successful or not, so a parent
   * can reload the data it owns (e.g. the currently displayed entry list
   * and the sidebar's unread counts). */
  onRefreshed?: () => void;
}

interface FailedFeed {
  readonly feedId: string;
  readonly feedTitle: string;
  readonly errorMessage: string;
}

export function RefreshContainer({ onRefreshed }: RefreshContainerProps) {
  const services = useServices();
  const [refreshing, setRefreshing] = useState(false);
  const [failedFeeds, setFailedFeeds] = useState<readonly FailedFeed[]>([]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await refreshFeeds(services);
      const failed = result.outcomes.filter((outcome) => outcome.status === "failed");
      const withTitles = await Promise.all(
        failed.map(async (outcome) => {
          const feed = await services.localStore.getFeed(outcome.feedId);
          return {
            feedId: outcome.feedId,
            feedTitle: feed?.title ?? outcome.feedId,
            errorMessage: outcome.errorMessage ?? "Refresh failed for an unknown reason.",
          };
        }),
      );
      setFailedFeeds(withTitles);
    } catch (error) {
      setFailedFeeds([
        { feedId: "refresh", feedTitle: "Refresh", errorMessage: describeError(error) },
      ]);
    } finally {
      setRefreshing(false);
      onRefreshed?.();
    }
  }, [services, onRefreshed]);

  return (
    <div class="refresh-container">
      <button
        type="button"
        class="refresh-container__button"
        aria-busy={refreshing}
        disabled={refreshing}
        onClick={() => void handleRefresh()}
      >
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>
      {failedFeeds.map((failed) => (
        <RefreshErrorChip
          key={failed.feedId}
          feedTitle={failed.feedTitle}
          errorMessage={failed.errorMessage}
        />
      ))}
    </div>
  );
}
