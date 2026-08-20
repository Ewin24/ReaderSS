/**
 * Composition root construction (design.md §1: "main.tsx is the only
 * construction site"). This is the first module in the whole slice sequence
 * that instantiates the production adapters for real -- every layer built
 * through Slice 9 stayed behind a port interface, exercised only by test
 * doubles. `main.tsx` calls `buildServices()` once at startup and threads
 * the result through `ServicesProvider` (the `Services` object) and
 * `SanitizerContext.Provider` (the `sanitize` function).
 *
 * `src/app/**` is not zoned by `eslint.config.js`'s `import-x/no-restricted-paths`
 * rule, unlike `services/**`/`ui/containers/**`, which is what makes this
 * exact file the one place allowed to import `adapters/**` directly outside
 * of `worker/**`.
 *
 * Root-cause fix (Slice 10b): this module previously wired only
 * `localStore`/`clock`/`feedSource`. `feedParser` was never constructed or
 * added to `Services`, so `services/subscribeToFeed.ts` and
 * `services/refreshFeeds.ts` -- and therefore the whole feed-ingestion half
 * of the app -- had no real caller anywhere in the production import graph.
 * Confirmed empirically: grepping the built `dist/` bundle before this fix
 * found DOMPurify and `idb` but zero feed-parsing markers (no `pubDate`, no
 * `enclosure`, no `subscribeToFeed`). `feedParser` is now wired below.
 */
import { openReaderSSDatabase } from "../../adapters/store/schema";
import { createIdbLocalStore } from "../../adapters/store/idbLocalStore";
import { RelayFeedSource } from "../../adapters/feed/relayFeedSource";
import { feedParser } from "../../adapters/feed/feedParser";
import { DomPurifySanitizer } from "../../adapters/security/domPurifySanitizer";
import type { SanitizeFn } from "../../ui/components/SafeHtml";
import type { Services } from "../providers/ServicesContext";

export interface BuiltServices {
  readonly services: Services;
  readonly sanitize: SanitizeFn;
}

/**
 * Opens the real IndexedDB database (`adapters/store/schema.ts`, including
 * its migration/destructive-reset handling) and wires every port to its
 * real production adapter. Tests call this directly against
 * `fake-indexeddb` (installed globally by `src/test/setup.ts`) to prove the
 * wiring reaches real adapter behaviour, not to fake it out.
 */
export async function buildServices(): Promise<BuiltServices> {
  const db = await openReaderSSDatabase();
  const sanitizer = new DomPurifySanitizer();

  const services: Services = {
    localStore: createIdbLocalStore(db),
    clock: { now: () => new Date().toISOString() },
    feedSource: new RelayFeedSource(),
    feedParser,
  };

  return {
    services,
    sanitize: (html, cacheKey) => sanitizer.sanitize(html, cacheKey),
  };
}
