/**
 * Access gate for the browsing site.
 *
 * The site lives on a *.workers.dev hostname, and Cloudflare Access can only protect
 * hostnames in a zone you own — so this Worker does the gating instead. It is a shared
 * secret in an HttpOnly cookie, not an identity system: no per-user accounts, no audit
 * log, no revocation beyond rotating the secret. That is an accepted trade-off for a
 * single-reader personal tool; anything with real users wants Access on a real domain.
 *
 * Every function here is pure so the gate can be unit-tested without a Worker runtime.
 */

/** Cookie the browser carries once the token has been presented once. */
export const COOKIE_NAME = "ainews_key";

/** Query parameter that bootstraps the cookie: visit /?k=<token> once. */
export const BOOTSTRAP_PARAM = "k";

/** Cookie lifetime. Long, because re-bootstrapping is a manual step. */
export const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Characters safe in a cookie value. A token containing anything else (a space, a
 * semicolon, a quote) would be mangled in transit and never match, leaving the site
 * permanently 404 with no obvious cause — so we reject it up front instead.
 */
const COOKIE_SAFE_TOKEN = /^[A-Za-z0-9._~+/=-]+$/;

/** Shortest token we will operate with. Guards against a placeholder like "test". */
export const MIN_TOKEN_LENGTH = 24;

/**
 * Whether the configured secret is usable at all.
 *
 * Checked before every request so a missing or weak secret fails closed. Serving the
 * site because the secret was not set would be precisely the failure this gate exists
 * to prevent.
 */
export function isTokenUsable(token: string | undefined): token is string {
  return (
    typeof token === "string" &&
    token.length >= MIN_TOKEN_LENGTH &&
    COOKIE_SAFE_TOKEN.test(token)
  );
}

/**
 * Compare two strings without an early exit on the first differing byte.
 *
 * Length is compared first and does leak, which is acceptable: the token length is not
 * secret, only its contents are.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Read one cookie out of a Cookie header. Returns null when absent. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return null;
}

/** Whether a request already carries a valid cookie. */
export function isAuthorized(cookieHeader: string | null, token: string): boolean {
  const presented = readCookie(cookieHeader, COOKIE_NAME);
  return presented !== null && timingSafeEqual(presented, token);
}

/** The Set-Cookie value that grants access. */
export function buildCookie(token: string): string {
  // HttpOnly: page scripts never need it. Secure: workers.dev is HTTPS-only.
  // SameSite=Lax: the cookie must survive following a link into the site.
  return [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

/**
 * Where to send the browser after a successful bootstrap.
 *
 * The token is stripped from the URL so it stops appearing in browser history, in
 * `Referer` headers to the outbound article links, and in any request logs.
 */
export function redirectTargetWithoutToken(url: URL): string {
  const cleaned = new URL(url.toString());
  cleaned.searchParams.delete(BOOTSTRAP_PARAM);
  return `${cleaned.pathname}${cleaned.search}${cleaned.hash}`;
}
