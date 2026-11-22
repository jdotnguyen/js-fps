/**
 * Yield to the browser's next animation frame so loading UI paints smoothly between CPU chunks.
 * Resolves immediately in headless/Node environments where `requestAnimationFrame` is absent.
 */
export function yieldFrame(): Promise<void> {
  if (typeof requestAnimationFrame === 'function') {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  return Promise.resolve();
}

/**
 * Yield until the browser has idle time (or a short timer fallback) for low-priority background work
 * such as decoding non-urgent audio clips. Resolves immediately in Node/headless environments.
 */
export function yieldIdle(timeoutMs = 150): Promise<void> {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === 'function') {
    return new Promise((resolve) => ric(() => resolve(), { timeout: timeoutMs }));
  }
  if (typeof requestAnimationFrame === 'function') {
    return new Promise((resolve) => setTimeout(resolve, 16));
  }
  return Promise.resolve();
}
