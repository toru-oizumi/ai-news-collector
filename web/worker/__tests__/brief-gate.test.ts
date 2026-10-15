import { describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "../auth.js";
import worker from "../index.js";

const GATE_VALUE = "EXAMPLE.not.a.real.value.0123456789";
describe("brief assets retain the existing access gate", () => {
  it.each(["/brief/brief.json", "/brief/brief.md", "/brief/manifest.json"])("does not expose %s without a valid existing cookie", async (path) => {
    const fetch = vi.fn();
    const env = { SITE_TOKEN: GATE_VALUE, ASSETS: { fetch } } as unknown as Parameters<typeof worker.fetch>[1];
    expect((await worker.fetch(new Request(`https://example.com${path}`), env)).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("serves authenticated brief JSON privately, without an authentication bypass", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"fixture":true}', { headers: { "content-type": "application/json" } }));
    const env = { SITE_TOKEN: GATE_VALUE, ASSETS: { fetch } } as unknown as Parameters<typeof worker.fetch>[1];
    const response = await worker.fetch(new Request("https://example.com/brief/brief.json", { headers: { Cookie: `${COOKIE_NAME}=${GATE_VALUE}` } }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("vary")).toContain("Cookie");
  });
});
