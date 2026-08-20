/**
 * Composition-root bootstrap, split out of `main.tsx` so it is independently
 * testable under jsdom (`src/main.tsx` itself lives outside every Vitest
 * project's `include` glob -- see `vite.config.ts`'s `app` project, scoped
 * to `src/{adapters,services,ui,app,styles}/**`).
 *
 * Finding 1 (Slice 10a correction round, BLOCKER): `buildServices()` opens
 * the real IndexedDB database before the first `render()`. If it rejects --
 * `adapters/store/schema.ts`'s own `DatabaseBlockedError`/timeout (added to
 * fix a two-tab hang) is one real path there, Safari private browsing is
 * another -- there was previously no `.catch()` anywhere and no component
 * tree for `<ErrorBoundary>` to protect yet (it only catches errors during
 * rendering, not a rejection that happens before rendering starts). The
 * result was a permanently blank page with a console message the user would
 * never see.
 *
 * `bootstrapApp` closes that gap: it never lets the rejection propagate
 * uncaught, and on failure it renders a visible, actionable message directly
 * into the root element via plain DOM APIs (`textContent`/`appendChild`),
 * bypassing Preact entirely since no component tree exists to catch into.
 */
import { render } from "preact";
import { App } from "../App";
import { ErrorBoundary } from "../ErrorBoundary";
import { ServicesProvider } from "../providers/ServicesContext";
import { SanitizerContext } from "../../ui/components/SafeHtml";
import { describeError } from "../../domain/errors/describeError";
import { buildServices } from "./buildServices";

/**
 * Renders a startup-failure fallback directly into `root`, replacing
 * whatever it currently contains. Built with `createElement`/`textContent`
 * (raw-HTML sinks are banned repo-wide outside `SafeHtml.tsx` by
 * `eslint.config.js` and enforced independently by
 * `rawHtmlSinkGuard.test.ts`) since the failure message and the error's own
 * text both need to reach the DOM as plain text, not markup.
 */
export function renderStartupFailure(root: HTMLElement, error: unknown): void {
  root.replaceChildren();

  const container = document.createElement("div");
  container.className = "app-error app-error--startup";
  container.setAttribute("role", "alert");

  const heading = document.createElement("h1");
  heading.textContent = "ReaderSS could not start";
  container.appendChild(heading);

  const explanation = document.createElement("p");
  explanation.textContent =
    "Local storage could not be opened, so your saved articles are not available right now.";
  container.appendChild(explanation);

  const detail = document.createElement("p");
  detail.className = "app-error__detail";
  detail.textContent = describeError(error);
  container.appendChild(detail);

  const actionsIntro = document.createElement("p");
  actionsIntro.textContent = "Things you can try:";
  container.appendChild(actionsIntro);

  const actions = document.createElement("ul");
  for (const action of [
    "Reload this page.",
    "Check that private browsing and storage are allowed for this site.",
    "Close other open tabs of this app, then reload.",
  ]) {
    const item = document.createElement("li");
    item.textContent = action;
    actions.appendChild(item);
  }
  container.appendChild(actions);

  root.appendChild(container);
}

/**
 * Builds the real production services and mounts `<App>`, or -- if that
 * fails -- renders `renderStartupFailure` into the same root instead. Never
 * rejects: `main.tsx` can call this with `void bootstrapApp(root)` and rely
 * on it to always leave the root element with visible content.
 */
export async function bootstrapApp(root: HTMLElement): Promise<void> {
  try {
    const { services, sanitize } = await buildServices();

    render(
      <ErrorBoundary>
        <ServicesProvider services={services}>
          <SanitizerContext.Provider value={sanitize}>
            <App />
          </SanitizerContext.Provider>
        </ServicesProvider>
      </ErrorBoundary>,
      root,
    );
  } catch (error) {
    console.error("ReaderSS: failed to start.", error);
    renderStartupFailure(root, error);
  }
}
