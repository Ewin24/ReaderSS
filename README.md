# ReaderSS

A lightweight, offline-capable RSS reader. Preact + Vite frontend, a
Cloudflare Worker relay for fetching feeds (avoids browser CORS and hides
the client's IP from feed origins), IndexedDB for local storage.

## Prerequisites

- Node.js (see `package.json` devDependencies for the versions this project
  was built against; `npm install` will warn if your Node version is older
  than what `jsdom` expects, but the app itself still runs)
- npm

## Setup

```bash
npm install
```

## Run the app

```bash
npm run dev
```

This is the **only** command needed to run the app locally. It starts Vite's
dev server with the `@cloudflare/vite-plugin`, which runs the actual
Cloudflare Worker (`worker/index.ts`, `wrangler.toml`) inside the same dev
server process via `workerd`. One command, one origin, one port: the app AND
`/api/*` (the feed relay) are both served from it, with HMR intact.

> **Why this matters**: running `vite` alone has no `/api/feed` route. Vite's
> own SPA fallback would answer any request to it with `index.html` (status
> 200), which the client would then try to parse as a feed and fail with a
> misleading "no feed was found" error for every single feed. If you ever see
> that error for a feed you know is valid, confirm you started the app with
> `npm run dev` (this command), not `npx vite` directly.

Open the URL Vite prints (e.g. `http://localhost:5173`).

## Build

```bash
npm run build
```

Builds the client assets and the Worker via the Cloudflare Vite plugin.
Output goes to `dist/client/` (static assets) and `dist/<worker-name>/`
(bundled Worker + a generated `wrangler.json` wrangler auto-detects).

## Deploy

```bash
npm run build
npx wrangler deploy
```

`wrangler deploy`, run from the repository root, automatically detects and
uses the Vite-generated deploy configuration — no extra flags needed. See
`DEPLOYMENT.md` for one-time dashboard steps (e.g. rate limiting) that are
not part of the application code.

## Test

```bash
npm test              # full suite, single run
npm run test:watch    # watch mode
npm run test:coverage # with coverage (enforced 70% threshold)
```

This project follows strict TDD (`openspec/config.yaml`, `strict_tdd: true`):
every behavior change starts with a failing test.

## Lint, typecheck, format

```bash
npm run lint
npm run typecheck
npm run format
```

## Project layout

- `src/` — client app (Preact): `domain/` (pure logic), `ports/` (interfaces),
  `adapters/` (port implementations), `services/` (use cases), `ui/`
  (components + containers), `app/` (composition root, providers).
- `worker/` — the Cloudflare Worker: the feed relay (`routes/feed.ts`),
  origin/SSRF guards (`guards/`), security headers (`headers/`).
- `shared/` — code imported by both `src/**` and `worker/**` (e.g. the relay
  error-code taxonomy in `shared/feedErrorCodes.ts`); each side is otherwise
  import-isolated from the other (`eslint.config.js`).
- `openspec/` — the spec-driven design process for this project (proposal,
  specs, design, tasks) — see `openspec/changes/rss-reader-mvp/` for the
  full history.
