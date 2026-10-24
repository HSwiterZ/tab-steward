/**
 * Every extension page starts here. In a real extension `chrome.runtime.id`
 * exists and this file stays dependency-free. When the same page is opened
 * over http/file during development, fall back to the mock — `src/dev` is
 * deliberately left out of the store package.
 */
const hasRealChrome = typeof chrome !== "undefined" && !!chrome.tabs && !!chrome.runtime?.id;
if (!hasRealChrome) {
  const { ensureMock } = await import("../dev/boot.js");
  await ensureMock();
}
await import("./main.js");
