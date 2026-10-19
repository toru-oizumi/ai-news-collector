import { describe, expect, it, vi } from "vitest";
import { MistralRequestError } from "../../digest/failures.js";
import { type EnrichmentRow, enrichOne } from "../processor.js";
import { eligible, readState } from "../state.js";

const body =
  "An open source language model is released for local inference. The release includes model weights and usage examples for researchers. No benchmark results have been published.";
const summary =
  "ローカル推論に使える言語モデルの重みと利用例が公開されました。ベンチマーク結果は公開されていません。";
const row = (): EnrichmentRow => ({
  pageId: "page",
  blockId: "block",
  title: "Open source language model",
  url: "https://example.com/post",
  state: {
    marker: "ai-news-processing:v1",
    status: "pending",
    attempts: 0,
    abstract: "",
    updatedAt: new Date(0).toISOString(),
  },
});
const dependencies = () => ({
  fetchBody: vi.fn().mockResolvedValue({ paragraphs: [body] }),
  generate: vi.fn().mockResolvedValue({
    text: JSON.stringify({
      relevant: true,
      summary,
      evidence: ["No benchmark results have been published."],
    }),
  }),
  persist: vi.fn().mockResolvedValue(undefined),
  now: () => 0,
});

describe("evidence-gated enrichment", () => {
  it("stores summary plus verbatim evidence without requiring translation", async () => {
    const deps = dependencies();
    await enrichOne(row(), deps);
    expect(deps.generate).toHaveBeenCalledTimes(1);
    expect(deps.persist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "ready",
        attempts: 1,
        input: "article_body",
        evidence: ["No benchmark results have been published."],
      }),
      summary
    );
  });

  it("does not summarize Northern Gannet sightings even if the source is a famous AI blog", async () => {
    const deps = dependencies();
    deps.fetchBody.mockResolvedValue({
      paragraphs: [
        "Northern Gannet. A seabird was observed flying near the coast. The observer recorded the location, date, plumage and behaviour of the bird during an afternoon walk along the shore.",
      ],
    });
    const article = {
      ...row(),
      title: "Northern Gannet",
      url: "https://simonwillison.net/2026/Aug/15/sighting-391300422/",
    };
    await enrichOne(article, deps);
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.persist).toHaveBeenCalledWith(
      article,
      expect.objectContaining({ status: "non_ai" }),
      ""
    );
  });

  it.each([{ paragraphs: [] }, { paragraphs: ["AI model announcement"] }])(
    "abstains when body is missing or insufficient: %j",
    async ({ paragraphs }) => {
      const deps = dependencies();
      deps.fetchBody.mockResolvedValue({ paragraphs });
      await enrichOne(row(), deps);
      expect(deps.generate).not.toHaveBeenCalled();
      expect(deps.persist.mock.calls[0][2]).toBe("");
      expect(deps.persist.mock.calls[0][1].status).toBe(
        paragraphs.length ? "insufficient_evidence" : "body_unavailable"
      );
    }
  );

  it("opens the rate-limit circuit on the first 429 with no retries or sleeps", async () => {
    const deps = dependencies();
    deps.generate.mockRejectedValue(
      new MistralRequestError({
        stage: "model",
        reason: "http_error",
        httpStatus: 429,
        code: "rate_limit_exceeded",
        retryAfterSeconds: 90,
      })
    );
    expect(await enrichOne(row(), deps)).toMatchObject({ rateLimited: true });
    expect(deps.generate).toHaveBeenCalledTimes(1);
    expect(deps.persist.mock.calls[0][1]).toMatchObject({
      status: "rate_limited",
      failure: {
        stage: "model",
        reason: "http_error",
        httpStatus: 429,
        code: "rate_limit_exceeded",
        retryAfterSeconds: 90,
      },
      attempts: 0,
      nextAttemptAt: "1970-01-01T06:00:00.000Z",
    });
  });

  it.each([
    '{"summary":"truncated',
    "plain text that invents benchmark results",
    JSON.stringify({
      relevant: true,
      summary,
      evidence: ["A completely fabricated supporting quote."],
    }),
    JSON.stringify({ relevant: true, summary, evidence: [] }),
  ])("rejects invalid or unsupported model output: %s", async (text) => {
    const deps = dependencies();
    deps.generate.mockResolvedValue({ text });
    await enrichOne(row(), deps);
    expect(deps.persist.mock.calls[0][1].status).toBe("invalid_response");
    expect(deps.persist.mock.calls[0][2]).toBe("");
  });

  it("keeps storage failures visible so the queue can replay them", async () => {
    const deps = dependencies();
    deps.persist.mockRejectedValue(new Error("notion unavailable"));
    await expect(enrichOne(row(), deps)).rejects.toThrow("notion unavailable");
  });

  it("limits transient retries to three and respects nextAttemptAt", () => {
    expect(eligible({ ...row().state, status: "body_unavailable", attempts: 3 }, 0)).toBe(false);
    expect(
      eligible({ ...row().state, status: "rate_limited", nextAttemptAt: "1970-01-01T06:00:00Z" }, 1)
    ).toBe(false);
    expect(eligible({ ...row().state, status: "ready" }, 0)).toBe(false);
    expect(eligible(row().state, 0)).toBe(true);
    expect(readState("not json")).toBeNull();
  });
});

it("rejects fabricated benchmark numbers even alongside a genuine supporting quote", async () => {
  const deps = dependencies();
  deps.generate.mockResolvedValue({
    text: JSON.stringify({
      relevant: true,
      summary:
        "公開されたモデルはベンチマークで99.9点を記録しました。ローカル推論の性能が向上しています。",
      evidence: ["No benchmark results have been published."],
    }),
  });
  await enrichOne(row(), deps);
  expect(deps.persist.mock.calls[0][1].status).toBe("invalid_response");
  expect(deps.persist.mock.calls[0][2]).toBe("");
});

it("does not let an AI-related title qualify a non-AI body", async () => {
  const deps = dependencies();
  deps.fetchBody.mockResolvedValue({
    paragraphs: [
      "A seabird was observed flying near the coast. The observer recorded the location, date, plumage and behaviour of the bird during an afternoon walk along the shore.",
    ],
  });
  await enrichOne(row(), deps); // AI title retained, unrelated body supplied
  expect(deps.generate).not.toHaveBeenCalled();
  expect(deps.persist.mock.calls[0][1].status).toBe("non_ai");
});

it("persists safe fetch diagnostics and clears stale failures on recovery", async () => {
  const deps = dependencies();
  deps.fetchBody.mockResolvedValueOnce({
    paragraphs: [],
    failure: { stage: "body", reason: "http_error", transport: "browser", httpStatus: 403 },
  });
  await enrichOne(row(), deps);
  const failed = deps.persist.mock.calls[0][1];
  expect(failed).toMatchObject({
    status: "body_unavailable",
    failure: { stage: "body", reason: "http_error", httpStatus: 403 },
  });
  expect(deps.generate).not.toHaveBeenCalled();
  await enrichOne({ ...row(), state: failed }, deps);
  expect(deps.persist.mock.calls[1][1]).toMatchObject({ status: "ready", failure: undefined });
});

it.each([0, 2, 3, 7])(
  "does not charge model quota errors against %i prior attempts",
  async (attempts) => {
    const deps = dependencies();
    deps.generate.mockRejectedValue(
      new MistralRequestError({
        stage: "model",
        reason: "http_error",
        httpStatus: 429,
      })
    );
    const result = await enrichOne(
      { ...row(), state: { ...row().state, status: "rate_limited", attempts } },
      deps
    );
    expect(result).toMatchObject({
      rateLimited: true,
      apiCalled: true,
      state: { attempts, status: "rate_limited" },
    });
    expect(result.state.nextAttemptAt).toBe("1970-01-01T06:00:00.000Z");
    expect(eligible(result.state, 6 * 60 * 60_000 - 1)).toBe(false);
    expect(eligible(result.state, 6 * 60 * 60_000)).toBe(true);
  }
);

it.each([400, 401, 403, 500, 503])("still charges a model HTTP %i failure", async (httpStatus) => {
  const deps = dependencies();
  deps.generate.mockRejectedValue(
    new MistralRequestError({ stage: "model", reason: "http_error", httpStatus })
  );
  const result = await enrichOne({ ...row(), state: { ...row().state, attempts: 2 } }, deps);
  expect(result).toMatchObject({
    rateLimited: false,
    state: { attempts: 3, status: "model_failed" },
  });
  expect(eligible(result.state, 6 * 60 * 60_000)).toBe(false);
});

it("recovers a legacy exhausted rate-limited row to ready and clears the failure", async () => {
  const deps = dependencies();
  const result = await enrichOne(
    {
      ...row(),
      state: {
        ...row().state,
        attempts: 7,
        status: "rate_limited",
        failure: { stage: "model", reason: "http_error", httpStatus: 429 },
      },
    },
    deps
  );
  expect(result).toMatchObject({
    rateLimited: false,
    state: { status: "ready", failure: undefined, nextAttemptAt: undefined },
  });
  expect(deps.persist.mock.calls[0][2]).toBe(summary);
});

it.each([
  [90, 6 * 60 * 60],
  [24 * 60 * 60, 24 * 60 * 60],
  [7 * 24 * 60 * 60, 7 * 24 * 60 * 60],
  [-1, 6 * 60 * 60],
  [Number.NaN, 6 * 60 * 60],
  [Number.POSITIVE_INFINITY, 6 * 60 * 60],
  [8 * 24 * 60 * 60, 6 * 60 * 60],
])(
  "honors bounded Retry-After %s without shortening the default cooldown",
  async (hint, seconds) => {
    const deps = dependencies();
    let time = 0;
    deps.now = () => time;
    deps.generate.mockImplementation(async () => {
      time = 45_000;
      throw new MistralRequestError({
        stage: "model",
        reason: "http_error",
        httpStatus: 429,
        retryAfterSeconds: hint,
      });
    });
    const result = await enrichOne(row(), deps);
    const retryAt = time + seconds * 1000;
    expect(result.state.nextAttemptAt).toBe(new Date(retryAt).toISOString());
    expect(eligible(result.state, retryAt - 1)).toBe(false);
    expect(eligible(result.state, retryAt)).toBe(true);
    expect(deps.generate).toHaveBeenCalledTimes(1);
    expect(result.state.attempts).toBe(0);
  }
);
