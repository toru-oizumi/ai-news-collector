/** SDK v2 times out only until headers arrive. Abort also bounds response-body reads. */
export const NOTION_REQUEST_TIMEOUT_MS = 10_000;
export const boundedNotionFetch: typeof fetch = (input, init) => {
  const controller = new AbortController();
  // Keep the abort timer alive through response.text(), not merely fetch-to-headers.
  const timer = setTimeout(() => controller.abort(), NOTION_REQUEST_TIMEOUT_MS);
  timer.unref();
  const signal = init?.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  return fetch(input, { ...init, signal });
};
