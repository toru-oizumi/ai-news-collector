import { defineCollection } from "astro:content";
import { file } from "astro/loaders";
// Astro 7 deprecated re-exporting `z` from astro:content.
import { z } from "astro/zod";

/**
 * Articles come from a JSON snapshot of the Notion database, written by
 * `npm run export:web` in the root package. The schema is the build-time contract:
 * a malformed or renamed Notion property fails the build here rather than rendering
 * a page full of blanks.
 */
const articles = defineCollection({
  // Path is resolved relative to the project root.
  loader: file("src/data/articles.json"),
  schema: z.object({
    title: z.string().min(1),
    // z.url(), not z.string().url() — the latter is deprecated in zod 4.
    url: z.url(),
    source: z.string().min(1),
    category: z.array(z.string()).default([]),
    score: z.number(),
    summary: z.string().default(""),
    // Notion date properties are exported as YYYY-MM-DD, or null when unset.
    published: z.string().nullable().default(null),
    fetched: z.string().nullable().default(null),
    status: z.enum(["Unread", "Digested", "Read", "Starred"]).catch("Unread"),
    lang: z.enum(["en", "ja"]).catch("en"),
    kind: z.enum(["primary", "secondary"]).catch("primary"),
    notionUrl: z.string().default(""),
  }),
});

export const collections = { articles };
