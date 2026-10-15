export interface ArtifactRef {
  id: number;
  name: string;
  expired?: boolean;
  workflow_run?: { id: number };
}
/** A result ledger must post-date the newest intent and belong to that intent's run. */
export function requireLatestDeliveryLedger(
  artifacts: ArtifactRef[],
  batch: string,
  sourceRun: string,
  sourceName: string
): void {
  if (!/^[a-f0-9]{64}$/.test(batch)) throw new Error("Invalid batch identity");
  const prefix = `slack-intent-${batch}-`;
  const latest = artifacts.filter((a) => a.name.startsWith(prefix)).sort((a, b) => b.id - a.id)[0];
  if (!latest) {
    if (!sourceName.startsWith("reviewed-slack-"))
      throw new Error("Missing initial reviewed outbox provenance");
    return;
  }
  const result = artifacts.find(
    (a) => a.name === sourceName && String(a.workflow_run?.id) === sourceRun && !a.expired
  );
  if (
    !result ||
    !result.name.startsWith(`slack-result-${batch}-`) ||
    result.workflow_run?.id !== latest.workflow_run?.id ||
    result.id <= latest.id
  )
    throw new Error("Prior intent exists; restore its latest result ledger or reconcile manually");
}
