import { HF_PAPERS_URL } from "../config.js";
import type { Article, Fetcher } from "../types.js";

interface HFPaper {
  title: string;
  paper: {
    id: string;
    title: string;
    summary: string;
    publishedAt: string;
  };
  publishedAt: string;
}

export const huggingFaceFetcher: Fetcher = {
  name: "HuggingFace Daily Papers",

  async fetch(): Promise<Article[]> {
    try {
      const res = await fetch(HF_PAPERS_URL, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        console.warn(`[HuggingFace] API returned ${res.status}`);
        return [];
      }

      const data = (await res.json()) as HFPaper[];

      return data.map((item) => ({
        title: item.paper.title,
        url: `https://huggingface.co/papers/${item.paper.id}`,
        source: "HuggingFace" as const,
        category: [],
        score: 0,
        summary: "",
        publishedAt: new Date(item.publishedAt),
        fetchedAt: new Date(),
        abstract: item.paper.summary?.slice(0, 1000) ?? "",
      }));
    } catch (err) {
      console.warn("[HuggingFace] Failed:", err);
      return [];
    }
  },
};
