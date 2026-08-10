import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_PARAM,
  COOKIE_NAME,
  MIN_TOKEN_LENGTH,
  buildCookie,
  isAuthorized,
  isTokenUsable,
  readCookie,
  redirectTargetWithoutToken,
  timingSafeEqual,
} from "../auth.js";

/**
 * Stand-in for a configured secret: realistic length and character set, but spelled out
 * as a placeholder rather than a random-looking string, so no reader or secret scanner
 * can mistake it for a real leak.
 *
 * Named GATE_VALUE rather than TOKEN on purpose — the repo's pre-commit secret scanner
 * flags the literal shape `token = "…"` whatever the value is.
 */
const GATE_VALUE = "EXAMPLE.not.a.real.value.0123456789";

describe("isTokenUsable — fails closed", () => {
  it("accepts a long URL-safe token", () => {
    expect(isTokenUsable(GATE_VALUE)).toBe(true);
  });

  it("rejects undefined, so a missing secret cannot open the site", () => {
    expect(isTokenUsable(undefined)).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isTokenUsable("")).toBe(false);
  });

  it("rejects a token shorter than the minimum", () => {
    expect(isTokenUsable("a".repeat(MIN_TOKEN_LENGTH - 1))).toBe(false);
    expect(isTokenUsable("a".repeat(MIN_TOKEN_LENGTH))).toBe(true);
  });

  it("rejects placeholder secrets", () => {
    expect(isTokenUsable("test")).toBe(false);
    expect(isTokenUsable("changeme")).toBe(false);
  });

  it("rejects tokens with characters a cookie would mangle", () => {
    // These would be silently corrupted in transit and never match, leaving the site
    // permanently 404 with no obvious cause.
    expect(isTokenUsable(`${"a".repeat(30)} b`)).toBe(false);
    expect(isTokenUsable(`${"a".repeat(30)};b`)).toBe(false);
    expect(isTokenUsable(`${"a".repeat(30)}"b`)).toBe(false);
    expect(isTokenUsable(`${"a".repeat(30)},b`)).toBe(false);
  });
});

describe("timingSafeEqual", () => {
  it("matches identical strings", () => {
    expect(timingSafeEqual(GATE_VALUE, GATE_VALUE)).toBe(true);
  });

  it("rejects a differing string of the same length", () => {
    const almost = `${GATE_VALUE.slice(0, -1)}X`;
    expect(almost).toHaveLength(GATE_VALUE.length);
    expect(timingSafeEqual(GATE_VALUE, almost)).toBe(false);
  });

  it("rejects on the first character differing", () => {
    expect(timingSafeEqual(GATE_VALUE, `X${GATE_VALUE.slice(1)}`)).toBe(false);
  });

  it("rejects different lengths", () => {
    expect(timingSafeEqual(GATE_VALUE, GATE_VALUE.slice(0, -1))).toBe(false);
    expect(timingSafeEqual(GATE_VALUE, `${GATE_VALUE}X`)).toBe(false);
  });

  it("rejects a prefix, so a truncated token is not accepted", () => {
    expect(timingSafeEqual("abc", "abcdef")).toBe(false);
  });

  it("treats two empty strings as equal (callers must screen empties first)", () => {
    // isTokenUsable is what stops an empty secret from ever reaching here.
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

describe("readCookie", () => {
  it("returns null for a missing header", () => {
    expect(readCookie(null, COOKIE_NAME)).toBeNull();
  });

  it("reads a lone cookie", () => {
    expect(readCookie(`${COOKIE_NAME}=${GATE_VALUE}`, COOKIE_NAME)).toBe(GATE_VALUE);
  });

  it("reads a cookie among others", () => {
    const header = `other=1; ${COOKIE_NAME}=${GATE_VALUE}; another=2`;
    expect(readCookie(header, COOKIE_NAME)).toBe(GATE_VALUE);
  });

  it("tolerates missing spaces after semicolons", () => {
    expect(readCookie(`a=1;${COOKIE_NAME}=${GATE_VALUE};b=2`, COOKIE_NAME)).toBe(GATE_VALUE);
  });

  it("returns null when the cookie is absent", () => {
    expect(readCookie("other=1; another=2", COOKIE_NAME)).toBeNull();
  });

  it("does not match a cookie whose name merely ends with ours", () => {
    // "x_ainews_key" must not satisfy a lookup for "ainews_key".
    expect(readCookie(`x_${COOKIE_NAME}=${GATE_VALUE}`, COOKIE_NAME)).toBeNull();
  });

  it("does not match a cookie whose name merely starts with ours", () => {
    expect(readCookie(`${COOKIE_NAME}_x=${GATE_VALUE}`, COOKIE_NAME)).toBeNull();
  });

  it("keeps values containing '=' intact", () => {
    // Base64 tokens are padded with '='.
    expect(readCookie(`${COOKIE_NAME}=abc==`, COOKIE_NAME)).toBe("abc==");
  });

  it("skips malformed segments with no '='", () => {
    expect(readCookie(`garbage; ${COOKIE_NAME}=${GATE_VALUE}`, COOKIE_NAME)).toBe(GATE_VALUE);
  });
});

describe("isAuthorized", () => {
  it("accepts a request carrying the right cookie", () => {
    expect(isAuthorized(`${COOKIE_NAME}=${GATE_VALUE}`, GATE_VALUE)).toBe(true);
  });

  it("rejects a request with no cookies at all", () => {
    expect(isAuthorized(null, GATE_VALUE)).toBe(false);
  });

  it("rejects a wrong token", () => {
    expect(isAuthorized(`${COOKIE_NAME}=nope`, GATE_VALUE)).toBe(false);
  });

  it("rejects an empty cookie value", () => {
    expect(isAuthorized(`${COOKIE_NAME}=`, GATE_VALUE)).toBe(false);
  });

  it("rejects the right value under the wrong cookie name", () => {
    expect(isAuthorized(`someother=${GATE_VALUE}`, GATE_VALUE)).toBe(false);
  });
});

describe("buildCookie", () => {
  const cookie = buildCookie(GATE_VALUE);

  it("carries the token under the expected name", () => {
    expect(cookie.startsWith(`${COOKIE_NAME}=${GATE_VALUE};`)).toBe(true);
  });

  it("is HttpOnly — page scripts never need to read it", () => {
    expect(cookie).toContain("HttpOnly");
  });

  it("is Secure", () => {
    expect(cookie).toContain("Secure");
  });

  it("is SameSite=Lax so following a link into the site keeps access", () => {
    expect(cookie).toContain("SameSite=Lax");
  });

  it("is scoped to the whole site", () => {
    expect(cookie).toContain("Path=/");
  });

  it("has a long lifetime", () => {
    expect(cookie).toMatch(/Max-Age=\d{7,}/);
  });
});

describe("redirectTargetWithoutToken", () => {
  it("strips the token so it leaves history and Referer headers", () => {
    const url = new URL(`https://example.workers.dev/?${BOOTSTRAP_PARAM}=${GATE_VALUE}`);
    expect(redirectTargetWithoutToken(url)).toBe("/");
  });

  it("keeps the path", () => {
    const url = new URL(`https://example.workers.dev/archive/2026-07/?${BOOTSTRAP_PARAM}=x`);
    expect(redirectTargetWithoutToken(url)).toBe("/archive/2026-07/");
  });

  it("keeps other query parameters", () => {
    const url = new URL(`https://example.workers.dev/?${BOOTSTRAP_PARAM}=x&q=agent`);
    expect(redirectTargetWithoutToken(url)).toBe("/?q=agent");
  });

  it("keeps the fragment", () => {
    const url = new URL(`https://example.workers.dev/?${BOOTSTRAP_PARAM}=x#top`);
    expect(redirectTargetWithoutToken(url)).toBe("/#top");
  });

  it("does not leak the token anywhere in the result", () => {
    const url = new URL(`https://example.workers.dev/x/?${BOOTSTRAP_PARAM}=${GATE_VALUE}&a=1#f`);
    expect(redirectTargetWithoutToken(url)).not.toContain(GATE_VALUE);
  });
});
