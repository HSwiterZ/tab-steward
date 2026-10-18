/**
 * Every extension page starts here. When the page is opened outside a real
 * extension context (plain http/file URL during development), the chrome.*
 * shim is installed first so the same code paths can be exercised and
 * screenshotted without loading the unpacked extension.
 *
 * Pages call it like:
 *   import { ensureMock } from "../dev/boot.js";
 *   await ensureMock();
 *   await import("./main.js");   // resolved against the page, not this file
 */
export async function ensureMock() {
  const hasRealChrome = typeof chrome !== "undefined" && !!chrome.tabs && !!chrome.runtime?.id && !globalThis.__MOCK_CHROME__;
  if (!hasRealChrome) {
    await import("./mock-chrome.js");
  }
}
