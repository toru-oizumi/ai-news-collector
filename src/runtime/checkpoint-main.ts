import { migrateModelCooldown } from "../enrichment/migrate-cooldown.js";
import { sealCheckpoint, validateCheckpoint } from "./checkpoint.js";
const mode = process.argv[2];
const action =
  mode === "seal"
    ? sealCheckpoint
    : mode === "validate"
      ? validateCheckpoint
      : mode === "migrate-model-cooldown"
        ? async () => {
            const result = await migrateModelCooldown(process.argv[3]);
            console.log(JSON.stringify(result));
            // A valid future deadline is successfully recovered, but it does not authorize a model call.
            if (result.status !== "expired") process.exitCode = 1;
          }
        : null;
if (!action) {
  console.error("Usage: checkpoint -- seal|validate|migrate-model-cooldown [directory]");
  process.exitCode = 1;
} else
  action().catch(() => {
    console.error(
      "Checkpoint validation/seal failed; restore a complete artifact or explicitly bootstrap. Collection must not continue with an unverified or missing queue."
    );
    process.exitCode = 1;
  });
