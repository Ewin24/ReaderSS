/**
 * Injected services via context (design.md §1's directory structure).
 * `ui/containers/**` binds `services/**` (via this context) to
 * `ui/components/**`, never importing `adapters/**` directly -- enforced by
 * `eslint.config.js`'s `import-x/no-restricted-paths` zone for
 * `ui/containers`. Only `toggleRead`/`toggleStar`'s dependencies are carried
 * here for Slice 6; later slices extend `Services` as more containers need
 * more service dependencies.
 */
import { createContext, type ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import type { ClockPort } from "../../ports/ClockPort";
import type { FeedParserPort } from "../../ports/FeedParserPort";
import type { FeedSourcePort } from "../../ports/FeedSourcePort";
import type { LocalStorePort } from "../../ports/LocalStorePort";

export interface Services {
  readonly localStore: LocalStorePort;
  readonly clock: ClockPort;
  /** Added in Slice 10a for the composition root (`buildServices.ts`); the
   * first real production callers are Slice 10b's add-feed and refresh
   * containers. */
  readonly feedSource: FeedSourcePort;
  /**
   * Added in Slice 10b. Root-cause fix: `buildServices()` previously wired
   * only `localStore`/`clock`/`feedSource`, so nothing in the app's real
   * import graph reached `adapters/feed/feedParser.ts` -- confirmed
   * empirically by grepping the built bundle, which contained DOMPurify and
   * `idb` but zero feed-parsing code. `subscribeToFeed`/`refreshFeeds` both
   * require a `FeedParserPort`, which is why every service that ingests a
   * feed needs this on `Services` alongside `feedSource`.
   */
  readonly feedParser: FeedParserPort;
}

const ServicesContext = createContext<Services | null>(null);

export interface ServicesProviderProps {
  services: Services;
  children: ComponentChildren;
}

export function ServicesProvider({ services, children }: ServicesProviderProps) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

/** Throws when used outside a `<ServicesProvider>` -- a container rendered
 * without its provider is a wiring bug, not a state to degrade gracefully. */
export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (services === null) {
    throw new Error("useServices() must be called within a <ServicesProvider>.");
  }
  return services;
}
