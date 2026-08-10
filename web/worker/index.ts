import {
  BOOTSTRAP_PARAM,
  buildCookie,
  isAuthorized,
  isTokenUsable,
  redirectTargetWithoutToken,
  timingSafeEqual,
} from "./auth.js";

interface Env {
  ASSETS: Fetcher;
  /** Shared secret, set with `wrangler secret put SITE_TOKEN`. Never in wrangler.jsonc. */
  SITE_TOKEN?: string;
}

/**
 * 404 rather than 401: the hostname is guessable, and an explicit "unauthorized" would
 * confirm to a scanner that something is here worth returning to.
 */
function deny(): Response {
  return new Response("Not found\n", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      // Cheap insurance against the 404 being framed or sniffed.
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * Re-issue an asset response with cache headers that keep gated content out of shared
 * caches.
 *
 * `private` is the part that matters: without it, a CDN or corporate proxy could store
 * a page keyed on its URL alone and later hand it to a request carrying no cookie.
 * Losing edge caching costs nothing at this scale — the whole site is a few hundred
 * small files read by one person.
 */
function allow(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, max-age=600");
  headers.append("vary", "Cookie");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const token = env.SITE_TOKEN;

    // Fail closed. A missing or placeholder secret must not open the site up.
    if (!isTokenUsable(token)) {
      console.error(
        "SITE_TOKEN is unset or unusable (needs >= 24 cookie-safe characters) — refusing to serve"
      );
      return deny();
    }

    const url = new URL(request.url);
    const bootstrap = url.searchParams.get(BOOTSTRAP_PARAM);

    // First visit: /?k=<token> exchanges the token for a cookie, then redirects to the
    // same page without it.
    if (bootstrap !== null) {
      if (!timingSafeEqual(bootstrap, token)) return deny();
      return new Response(null, {
        status: 302,
        headers: {
          location: redirectTargetWithoutToken(url),
          "set-cookie": buildCookie(token),
          "cache-control": "no-store",
        },
      });
    }

    if (!isAuthorized(request.headers.get("Cookie"), token)) return deny();

    return allow(await env.ASSETS.fetch(request));
  },
} satisfies ExportedHandler<Env>;
