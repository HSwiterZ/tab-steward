import { store } from "../core/storage.js";
import { urlKey } from "../core/utils.js";
import { isOn } from "../core/modules.js";

const MAX_ENTRIES = 12;
const TARGET_WIDTH = 360;

function cache() {
  return store.get("screenshots") || {};
}

export function getPreview(url) {
  const settings = store.get("settings") || {};
  if (!isOn(settings, "screenshotPreview")) return null;
  const entry = cache()[urlKey(url)];
  if (!entry) return null;
  const maxAge = (settings.experimental?.screenshotMaxAgeMinutes ?? 30) * 60_000;
  if (Date.now() - entry.at > maxAge) return null;
  return entry;
}

/** Shrink before storing — a full-window PNG would blow through the cache in one session. */
async function downscale(dataUrl) {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return dataUrl;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, TARGET_WIDTH / bitmap.width);
    if (scale >= 1 && bitmap.width <= TARGET_WIDTH * 2) return dataUrl;
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.55 });
    return await blobToDataUrl(out);
  } catch (err) {
    console.warn("[screenshots] downscale failed, storing raw", err);
    return dataUrl;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

/**
 * Capture the visible tab and cache it by URL. Only works for the tab that is
 * actually on screen, so callers invoke it from onActivated.
 */
export async function capturePreview(tab) {
  const settings = store.get("settings") || {};
  if (!isOn(settings, "screenshotPreview")) return null;
  if (!tab?.url || /^(chrome|edge|about|devtools|chrome-extension):/.test(tab.url)) return null;
  if (!chrome.tabs.captureVisibleTab) return null;

  let raw;
  try {
    raw = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 60 });
  } catch (err) {
    // Missing host permission is the usual cause; surface it once, don't spam.
    console.info("[screenshots] capture unavailable:", err?.message || err);
    return null;
  }

  const data = await downscale(raw);
  const next = { ...cache(), [urlKey(tab.url)]: { data, at: Date.now(), title: tab.title } };
  const keys = Object.keys(next);
  if (keys.length > MAX_ENTRIES) {
    for (const k of keys.sort((a, b) => next[a].at - next[b].at).slice(0, keys.length - MAX_ENTRIES)) delete next[k];
  }
  await store.set("screenshots", next);
  return next[urlKey(tab.url)];
}

export async function clearPreviews() {
  await store.set("screenshots", {});
}

/** Whether the host permission needed for capture is actually granted. */
export async function hasCapturePermission() {
  if (!chrome.permissions?.contains) return false;
  return chrome.permissions.contains({ origins: ["<all_urls>"] }).catch(() => false);
}
