export function logDebug(...args: unknown[]): void {
  // Prefix to make filtering easy in DevTools.
  console.debug("[RetractionAlert]", ...args);
}
