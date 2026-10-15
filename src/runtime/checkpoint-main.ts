import { sealCheckpoint, validateCheckpoint } from "./checkpoint.js";
const mode = process.argv[2];
const action = mode === "seal" ? sealCheckpoint : mode === "validate" ? validateCheckpoint : null;
if (!action) {
  console.error("Usage: checkpoint -- seal|validate");
  process.exitCode = 1;
} else
  action().catch(() => {
    console.error(
      "Checkpoint validation/seal failed; restore a complete artifact or explicitly bootstrap. Collection must not continue with an unverified or missing queue."
    );
    process.exitCode = 1;
  });
