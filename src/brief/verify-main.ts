import { renderBundle } from "./bundle.js";
import { verifyBriefFiles } from "./files.js";

async function main(): Promise<void> {
  const [directory, repository, ref, runId, attempt, sha] = process.argv.slice(2);
  if (!directory || !repository || !ref || !runId || !sha || !/^[1-9]\d*$/.test(attempt ?? ""))
    throw new Error(
      "Expected bundle-directory repository ref run-id attempt sha from the newest run"
    );
  const bundle = await verifyBriefFiles(
    directory,
    { repository, ref, runId, attempt: Number(attempt), sha, url: "" },
    Date.now()
  );
  console.log(renderBundle(bundle));
}
main().catch(() => {
  console.error(
    "Brief is unavailable, expired, mismatched or corrupt. Do not deliver it or fall back to older news."
  );
  process.exitCode = 1;
});
