import { expect, it } from "vitest";
import { type ArtifactRef, requireLatestDeliveryLedger } from "../replay.js";

const batch = "a".repeat(64);
const intent: ArtifactRef = { id: 10, name: `slack-intent-${batch}-1`, workflow_run: { id: 100 } };
const result: ArtifactRef = { id: 11, name: `slack-result-${batch}-1`, workflow_run: { id: 100 } };
it("allows a first reviewed outbox and a current result ledger, never an old prepared copy", () => {
  expect(() => requireLatestDeliveryLedger([], batch, "90", "reviewed-slack-90")).not.toThrow();
  expect(() =>
    requireLatestDeliveryLedger([intent, result], batch, "100", result.name)
  ).not.toThrow();
  expect(() =>
    requireLatestDeliveryLedger([intent, result], batch, "90", "reviewed-slack-90")
  ).toThrow();
});
it("refuses a result preceding the latest intent, expired results or another run", () => {
  expect(() =>
    requireLatestDeliveryLedger(
      [intent, result, { ...intent, id: 12, workflow_run: { id: 101 } }],
      batch,
      "100",
      result.name
    )
  ).toThrow();
  expect(() =>
    requireLatestDeliveryLedger([intent, { ...result, expired: true }], batch, "100", result.name)
  ).toThrow();
  expect(() => requireLatestDeliveryLedger([intent, result], batch, "999", result.name)).toThrow();
  expect(() => requireLatestDeliveryLedger([intent], batch, "100", result.name)).toThrow();
});
