import { readFile } from "node:fs/promises";
import { type ArtifactRef, requireLatestDeliveryLedger } from "./replay.js";
async function main(): Promise<void> {
  const artifacts = JSON.parse(await readFile("slack-artifacts.json", "utf8")) as ArtifactRef[];
  requireLatestDeliveryLedger(
    artifacts,
    process.env.BATCH ?? "",
    process.env.SOURCE_RUN_ID ?? "",
    process.env.SOURCE_ARTIFACT ?? ""
  );
}
main().catch(() => {
  console.error(
    "Prior Slack intent cannot be reconciled with the selected result ledger; posting is blocked"
  );
  process.exitCode = 1;
});
