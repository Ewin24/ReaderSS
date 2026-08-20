# ReaderSS

A lightweight RSS/Atom reader. Preact + Vite frontend, a Cloudflare Worker
relay for fetching feeds, IndexedDB for local storage. No account, no
server-side database — everything you subscribe to lives in your browser.

This README covers two things: how to use the deployed app, and how to work
on the code. Jump to whichever you need.

---

## Using ReaderSS

### Why a relay exists

Browsers cannot fetch most feeds directly: feed servers rarely send CORS
headers, so a plain client-side `fetch()` to a feed URL is blocked by the
browser itself. ReaderSS routes every feed request through a Cloudflare
Worker (`/api/feed`) that fetches on the app's behalf and hands the result
back. This is not optional plumbing — it is the reason the app needs a
server component at all, small as it is.

### Adding your first feed

Paste an absolute `http://` or `https://` feed URL into "Feed URL" and
submit. The app reports exactly what happened — see the table below for
every possible outcome and what to do about it.

### What each action does

| Action | Effect |
| --- | --- |
| Add feed | Fetches and parses the URL through the relay, then stores the feed and its entries. |
| Remove feed | Asks for confirmation, then deletes the feed **and every entry stored for it, including starred ones**. This cannot be undone. |
| Open an entry | Marks it read automatically. |
| Mark as unread | Explicit action in the reading pane; only shown on entries that are currently read. |
| Star / unstar | Toggles independently of read state. Starred entries are exempt from the retention prune (see below). |
| Refresh | Re-fetches every subscribed feed using conditional GET (`ETag`/`If-Modified-Since`), so unchanged feeds cost near-nothing. Each feed's outcome is reported on its own. |

Every read/unread and star/unstar change records its own timestamp
internally (used to resolve conflicts if sync is ever added — see
[No GitHub sync](#no-github-sync-yet) below). A no-op toggle (setting a value
it already has) does not touch that timestamp.

### Add-feed outcomes and what to do

Adding a feed reports one of eight distinct outcomes — never a generic
"something went wrong":

| Outcome | Meaning | What to do |
| --- | --- | --- |
| Added | Subscribed successfully. | Nothing. |
| Already subscribed | This feed URL is already in your list. | Nothing — check your feed list. |
| Enter an absolute http(s) URL | The text you entered isn't a valid absolute URL. | Fix the URL and resubmit. |
| No feed was found at `<url>` | The relay reached the URL, but the content isn't a feed it can parse. | Confirm the URL actually serves RSS/Atom/JSON Feed, not an HTML page. |
| Could not reach `<url>` | The relay tried to reach the origin server and failed (DNS, connection refused, timeout, non-2xx status, blocked target). | Check the URL and that the site is up; try again later. |
| Feed relay isn't responding | The `/api/feed` endpoint itself didn't answer as a relay should (most common in local dev when the Worker isn't wired in). | If self-hosting/developing: confirm you started the app with `npm run dev`, not `npx vite` alone. |
| Feed is too large to fetch | The response body exceeded the relay's 5 MiB cap. | Nothing to fix client-side; this feed is rejected by design. |
| Feed was found but could not be saved | Fetch and parse succeeded, but the local IndexedDB write failed (e.g. storage quota). | Free up browser storage or check the browser console for the underlying error. |

### Where your data lives

Everything — subscriptions, entries, read state, stars — is stored in your
browser's IndexedDB, scoped to the app's origin. Practically, this means:

- **Clearing browser storage/site data for this app deletes everything.**
  There is no server-side copy.
- **There is no backup and no sync yet** (see below). One browser, one
  machine.
- To keep storage bounded, entries are pruned on a rolling basis: unread
  entries are never pruned inside a 30-day window, read+unstarred entries
  are dropped once they cross a 90-day age cap or a feed exceeds its
  per-feed cap, and this tightens further if the browser's storage quota is
  under pressure. **Starred entries are never pruned**, regardless of age.

### What removal destroys

Removing a feed (after confirming) deletes the feed record and cascades to
**every entry stored for it, including starred ones**. Starring an entry
does not protect it from feed removal — only from the automatic retention
prune above.

### Reading offline

The app shell (the JS/CSS/HTML needed to launch the app) is precached by a
service worker, and a PWA manifest is present, so the app can be installed.
Because entries already synced into IndexedDB persist locally, opening
already-read feeds while offline is *expected* to work — but this has not
been verified in a real browser under real offline conditions. Treat it as
untested, not guaranteed. There is no offline indicator, no "you're back
online" UI, no update-available prompt, and article images are not
cached — they still require a live network connection to load.

### What doesn't exist yet

Stated plainly, not implied:

- **No GitHub sync.** No token entry, no configuration repository, no
  subscription or read-state sync to anywhere. `api.github.com` appears only
  in the app's Content-Security-Policy, reserved for a possible future
  feature — nothing calls it today. (The IndexedDB schema and one data model
  do carry forward-looking names referencing a future GitHub-based merge,
  but no sync code exists to use them.)
- **No cross-device sync, no merge algorithm.**
- **No OPML import or export.**
- **No full-text search.**
- **No folders or tags** in the UI (the data model has an internal `folder`
  field, unused by any screen).
- **No article extraction.** Feeds that provide only a summary link out to
  the original article instead of fetching full content.

---

## Working on ReaderSS

### Layout

| Path | Contents |
| --- | --- |
| `src/domain/` | Pure logic: models, retention policy, URL/identity helpers. No I/O. |
| `src/ports/` | Interfaces the domain/services depend on (storage, feed source, parser, clock, sanitizer). |
| `src/adapters/` | Concrete implementations of ports (IndexedDB store, relay-backed feed source, DOMPurify sanitizer). |
| `src/services/` | Use cases: `subscribeToFeed`, `refreshFeeds`, `toggleRead`, `toggleStar`. |
| `src/ui/components/` | Presentational components — props in, callbacks out, no port/service imports. |
| `src/ui/containers/` | Binds components to real services via context. |
| `src/app/` | Composition root: wires adapters to services, providers, top-level `App.tsx`. |
| `worker/` | The Cloudflare Worker: feed relay (`routes/feed.ts`), origin/SSRF guards (`guards/`), security headers (`headers/`). |
| `shared/` | The only code imported by both `src/**` and `worker/**` (currently the relay error-code taxonomy). |

### Dependency direction (ESLint-enforced)

```
domain <- ports <- services <- ui/containers
```

`domain/**` imports nothing from any other layer. `ports/**` may only import
`domain/**`. `services/**` may only import `domain/**` and `ports/**`.
`ui/components/**` is presentational-only (no ports, services, or adapters).
`ui/containers/**` may use services/domain via context and compose
components, but never import adapters directly. `worker/**` must never
import from `src/**`, and vice versa — `shared/**` is the only place both
sides may import from. All of this is enforced by
`import-x/no-restricted-paths` in `eslint.config.js`, not just documented.

### Security boundary 1: raw feed HTML never bypasses sanitization

Feed HTML is untrusted input. Exactly one component,
`src/ui/components/SafeHtml`, is allowed to put raw-derived HTML into the
DOM, and exactly one module, `src/adapters/security/domPurifySanitizer.ts`,
is allowed to import `dompurify`. Three independent mechanisms enforce this:

1. An ESLint `no-restricted-syntax` rule bans `dangerouslySetInnerHTML`,
   `.innerHTML`/`.outerHTML`/`.srcdoc`, `insertAdjacentHTML`,
   `document.write`, `DOMParser#parseFromString`,
   `Range#createContextualFragment`, and `setHTMLUnsafe` everywhere except
   `SafeHtml.tsx`, plus a `no-restricted-imports` rule banning `dompurify`
   outside `src/adapters/security/**`.
2. A guard test (`src/adapters/security/rawHtmlSinkGuard.test.ts`) scans the
   actual production source tree on disk for the same sink patterns and for
   any `eslint-disable` comment that names either rule — so the guard holds
   even if ESLint itself wasn't run or its result was ignored.
3. `SafeHtml` itself refuses to render at all if no sanitizer was provided,
   rather than falling back to an unsanitized render.

Two limitations are disclosed rather than hidden: the sink list is an
**enumeration** (it will not catch a sink no one thought to add), and a
computed property access built by **string concatenation**
(e.g. `el["inner" + "HTML"]`) is a documented, deliberate gap — its AST node
is a `BinaryExpression`, not a `Literal`, so no regex or ESLint AST selector
matching a literal property value can express it without full
data-flow analysis. The guard test asserts this gap exists rather than
silently leaving it unproven.

### Security boundary 2: the relay's SSRF guard

The relay (`worker/routes/feed.ts`) validates every hop of a redirect
chain, not just the URL the client submitted — a redirect can point
somewhere the original URL didn't, so the guard (`worker/guards/targetUrlGuard.ts`)
re-runs on every `Location` header, up to a 3-hop cap. `fetch()` is called
with `redirect: "manual"` specifically so the runtime cannot silently follow
a hop around the guard before it gets a chance to inspect it. Rejected
targets include loopback, private/link-local/carrier-grade-NAT IPv4 and
IPv6 ranges, non-`http(s)` schemes, embedded credentials, disallowed ports,
and reserved local hostnames.

Two things this guard does **not** do, stated explicitly:

- The relay also checks the caller's `Origin` (falling back to `Sec-Fetch-Site`/`Referer`)
  against the deployment's own origin. This **raises the cost of casual
  browser-based abuse** — a malicious page on another origin cannot forge
  these headers — but it is **not authentication**: a raw HTTP client (curl,
  a script) can set every one of these headers to anything it wants.
- The guard validates a hostname *string* at check time; it has no control
  over DNS resolution or socket-level IP pinning. **DNS rebinding is not
  prevented** — a hostname that resolves to a public address when the guard
  runs could resolve to a private address by the time the actual outbound
  fetch happens.

The relay also enforces a content-type allow-list (RSS/Atom/RDF/XML/JSON
feed types only), a 5 MiB streamed response-size cap that aborts as soon as
the cap is crossed (never trusting `Content-Length`), and a single 10-second
cumulative deadline covering the whole request including every redirect hop
— not a fresh timer per hop.

### Testing

This project follows strict TDD: every behavior change starts with a
failing test. Coverage is enforced by the test command itself, not merely
documented — `vite.config.ts` sets an 80/20 v8 threshold (70% statements,
branches, functions, and lines) that fails the run if unmet.

```bash
npm test              # full suite, single run
npm run test:watch    # watch mode
npm run test:coverage # with coverage (enforced 70% threshold)
```

### Running locally

```bash
npm install
npm run dev
```

This is the **only** command needed to run the app locally. It starts
Vite's dev server with the `@cloudflare/vite-plugin`, which runs the actual
Cloudflare Worker (`worker/index.ts`, `wrangler.toml`) inside the same dev
server process via `workerd`. One command, one origin, one port: the app AND
`/api/*` (the feed relay) are both served from it, with HMR intact.

> **Why this matters**: running `vite` alone has no `/api/feed` route.
> Vite's own SPA fallback would answer any request to it with `index.html`
> (status 200), which the client would then try to parse as a feed and fail
> with a misleading "no feed was found" error for every single feed. If you
> ever see that error for a feed you know is valid, confirm you started the
> app with `npm run dev` (this command), not `npx vite` directly.

Open the URL Vite prints (e.g. `http://localhost:5173`).

### Build

```bash
npm run build
```

Builds the client assets and the Worker via the Cloudflare Vite plugin.
Output goes to `dist/client/` (static assets) and `dist/<worker-name>/`
(bundled Worker + a generated `wrangler.json` wrangler auto-detects).

### Lint, typecheck, format

```bash
npm run lint
npm run typecheck
npm run format
```

### Deployment

```bash
npm run build
npx wrangler deploy
```

`wrangler deploy`, run from the repository root, automatically detects and
uses the Vite-generated deploy configuration — no extra flags needed. See
`DEPLOYMENT.md` for one-time dashboard steps (e.g. rate limiting) that are
not part of the application code.

The live deployment runs at a `*.workers.dev` URL; the repository itself is
public at `github.com/Ewin24/ReaderSS`, MIT licensed.

#### Automatic deploys

`.github/workflows/deploy.yml` publishes on every push to the default
branch, after lint, typecheck, and the test suite pass. Pull requests run
the same checks but never deploy.

It requires two repository secrets, both created once:

| Secret | Where it comes from |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create Token → **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → Account ID (right-hand column) |

Add them under **Settings → Secrets and variables → Actions** in the GitHub
repository. Scope the API token to the single account that hosts this
Worker; it does not need Zone or DNS permissions unless a custom domain is
added later.

The workflow triggers on `main` and `master`, since this repository's local
history uses `master` while GitHub creates new repositories with `main`.

### No GitHub sync yet

Worth calling out for anyone extending this codebase: `EntryState`
(`src/domain/models/EntryState.ts`) and a preserved `config/github`
IndexedDB record (`src/adapters/store/schema.ts`) exist as **forward-looking
scaffolding** for a possible future GitHub-based sync, but no sync logic —
no token handling, no `api.github.com` calls, no merge algorithm — has been
built. `src/domain/merge/` does not exist. Treat any reference to "GitHub"
in the code as a named placeholder for future work, not a working feature.
