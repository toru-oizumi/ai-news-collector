import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { extractArticleUrl } from "../../slack/reactions.js";
import type { Article } from "../../types.js";
import { deliverOutbox, prepareOutbox, withOutboxLock } from "../outbox.js";

const article: Article = {
  title: "Article",
  url: "https://example.com/article",
  source: "OpenAI",
  category: [],
  summary: "",
  score: 1,
  abstract: "",
  fetchedAt: new Date(0),
  publishedAt: null,
};
const prepare = () => prepareOutbox([article], "channel", "2026-10-15");

describe("optional Slack delivery", () => {
  it("prepares without sending and posts each parent/reply at most once on replay", async () => {
    const box = prepare();
    const send = vi.fn().mockResolvedValue({ ok: true, ts: "123.456" });
    const deps = { send, wait: vi.fn(), checkpoint: vi.fn() };
    await deliverOutbox(box, deps);
    await deliverOutbox(box, deps);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].thread_ts).toBe("123.456");
    expect(extractArticleUrl(send.mock.calls[1][0].text)).toBe(article.url);
  });
  it("retains successful parent and retries only a known-failed reply", async () => {
    const box = prepare();
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, ts: "parent" })
      .mockResolvedValueOnce({ ok: false, error: "ratelimited", rejected: true })
      .mockResolvedValueOnce({ ok: true, ts: "reply" });
    const deps = { send, wait: vi.fn(), checkpoint: vi.fn() };
    await expect(deliverOutbox(box, deps)).rejects.toThrow("failed");
    await deliverOutbox(box, deps);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2][0].thread_ts).toBe("parent");
  });
  it("refuses to resend an ambiguous committed response", async () => {
    const box = prepare();
    const send = vi.fn().mockRejectedValue(new Error("connection lost after commit"));
    const deps = { send, wait: vi.fn(), checkpoint: vi.fn() };
    await expect(deliverOutbox(box, deps)).rejects.toThrow("uncertain");
    await expect(deliverOutbox(box, deps)).rejects.toThrow("outcome unknown");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("leaves a sending intent when result checkpointing fails, blocking replay", async () => {
    const box = prepare();
    let durable = JSON.stringify(box);
    const send = vi.fn().mockResolvedValue({ ok: true, ts: "parent" });
    let writes = 0;
    const checkpoint = vi.fn(async () => {
      if (++writes === 2) throw new Error("disk failure");
      durable = JSON.stringify(box);
    });
    await expect(deliverOutbox(box, { send, wait: vi.fn(), checkpoint })).rejects.toThrow();
    await expect(
      deliverOutbox(JSON.parse(durable), { send, wait: vi.fn(), checkpoint })
    ).rejects.toThrow("outcome unknown");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("never sends if the pre-send intent cannot be saved", async () => {
    const send = vi.fn();
    await expect(
      deliverOutbox(prepare(), {
        send,
        wait: vi.fn(),
        checkpoint: vi.fn().mockRejectedValue(new Error("disk failure")),
      })
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it("excludes concurrent CLI deliveries on the same outbox", async () => {
    const dir = await mkdtemp(join(tmpdir(), "outbox-lock-"));
    try {
      await withOutboxLock(join(dir, "batch"), async () => {
        await expect(withOutboxLock(join(dir, "batch"), async () => undefined)).rejects.toThrow();
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

it.each([{}, { error: "missing ok" }, { ok: true }, { ok: false, error: "internal_error" }])(
  "treats malformed or ambiguous responses as uncertain: %j",
  async (response) => {
    const box = prepare();
    const send = vi.fn().mockResolvedValue(response);
    const deps = { send, wait: vi.fn(), checkpoint: vi.fn() };
    await expect(deliverOutbox(box, deps)).rejects.toThrow("uncertain");
    await expect(deliverOutbox(box, deps)).rejects.toThrow("outcome unknown");
    expect(send).toHaveBeenCalledTimes(1);
  }
);
