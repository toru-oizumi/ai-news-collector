import { defineConfig } from "astro/config";

// Fully static output — the site is a snapshot of the Notion database rendered at build
// time, so there is no server runtime and no Cloudflare adapter is needed. The build
// output in dist/ is uploaded as Workers Static Assets.
export default defineConfig({
  output: "static",
  // Access-gated private site: no canonical origin to bake in, and trailing-slash
  // consistency keeps the Workers asset router from redirecting between forms.
  trailingSlash: "always",
  build: { format: "directory" },
  devToolbar: { enabled: false },
});
