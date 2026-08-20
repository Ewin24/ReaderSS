# Deployment Checklist

Operational steps outside the application code. Nothing here is implemented
in-Worker; each item is a one-time or per-deploy dashboard/CLI action.

## Cloudflare dashboard

- [ ] **Rate-limit `/api/feed`** (design.md §2 "Abuse: an open
      fetch relay is an open proxy" — "Quota exhaustion" row). Configure a
      Cloudflare WAF rate-limiting rule scoped to `/api/feed`, keyed per
      client IP, at roughly 60 requests/minute. This bounds quota exhaustion
      of the Worker's daily request budget by a caller that has read the
      client source and can call the relay directly (see
      `worker/guards/originGuard.ts` — the Origin/Referer check is not
      authentication and does not prevent this on its own). This is a
      dashboard action; deliberately no application code implements it.
