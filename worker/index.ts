/**
 * Worker entrypoint (Slice 1 stub). The /api/* route table (feed relay,
 * health check) is wired in Slice 4; for now every request is served from
 * static assets, with the security headers applied to every response.
 */
import { applySecurityHeaders } from "./headers/security";

interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetsBinding;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await env.ASSETS.fetch(request);
    return applySecurityHeaders(response);
  },
};
