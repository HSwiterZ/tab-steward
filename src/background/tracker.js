import { store } from "../core/storage.js";
import { urlKey, hostname, siteOf } from "../core/utils.js";
import { bumpActivation, addForeground, emptyStat, pruneStats } from "../core/stats.js";
import { autoPurge } from "../core/trash.js";

const SESSION_KEY = "tracker";
const MAX_SEGMENT_MS = 30 * 60_000; // never credit more than 30 min to one gap

let cache = null;

async function load() {
  if (cache) return cache;
  const raw = await chrome.storage?.session?.get?.(SESSION_KEY).catch?.(() => null);
  cache = raw?.[SESSION_KEY] || { tabId: null, url: null, since: 0, focused: true };
  return cache;
}

async function save(next) {
  cache = next;
  await chrome.storage?.session?.set?.({ [SESSION_KEY]: next }).catch?.(() => {});
}

/**
 * Credit the elapsed foreground time to the tab that had it, then move on.
 * Called on every activation, focus change and once a minute by an alarm, so a
 * service-worker restart loses at most one flush interval.
 */
export async function flush(reference = Date.now()) {
  const state = await load();
  if (!state.tabId || !state.url || !state.since) {
    if (state.tabId) await save({ ...state, since: reference });
    return { credited: 0 };
  }
  const elapsed = Math.min(reference - state.since, MAX_SEGMENT_MS);
  let credited = 0;
  if (state.focused && elapsed > 900) {
    await addForeground(state.url, elapsed);
    credited = elapsed;
  }
  await save({ ...state, since: reference });
  return { credited, url: state.url };
}

async function beginTracking(tab, reference = Date.now()) {
  if (!tab || !tab.url) return;
  const key = urlKey(tab.url);
  if (!key || /^(chrome|edge|about|devtools|chrome-extension):/.test(tab.url)) {
    await save({ tabId: tab.id, url: null, since: reference, focused: true });
    return;
  }
  await bumpActivation(tab.url, reference);
  await ensureStat(tab, reference);
  await save({ tabId: tab.id, url: tab.url, since: reference, focused: true });
}

async function ensureStat(tab, reference = Date.now()) {
  const key = urlKey(tab.url);
  if (!key) return;
  const stats = { ...(store.get("stats") || {}) };
  if (!stats[key]) {
    stats[key] = { ...emptyStat(tab.url, tab.title), firstVisitAt: reference, openedAt: reference };
  } else if (tab.title && stats[key].title !== tab.title) {
    stats[key] = { ...stats[key], title: tab.title };
  }
  await store.set("stats", stats);
}

export function installTracker() {
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    await flush();
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab) await beginTracking(tab);
  });

  chrome.tabs.onCreated.addListener(async (tab) => {
    if (!tab.url && !tab.pendingUrl) return;
    await ensureStat({ ...tab, url: tab.url || tab.pendingUrl });
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.title) await ensureStat(tab);
    if (changeInfo.status === "complete" && changeInfo.url) await ensureStat(tab);
    const state = await load();
    if (state.tabId === tabId && changeInfo.url && urlKey(changeInfo.url) !== urlKey(state.url || "")) {
      await flush();
      await beginTracking(tab);
    }
    if (changeInfo.discarded === false && tab.url) {
      const stats = { ...(store.get("stats") || {}) };
      const k = urlKey(tab.url);
      if (stats[k]) {
        stats[k] = { ...stats[k], lastWakeAt: Date.now() };
        await store.set("stats", stats);
      }
    }
  });

  chrome.tabs.onRemoved.addListener(async (tabId) => {
    const state = await load();
    if (state.tabId === tabId) {
      await flush();
      await save({ tabId: null, url: null, since: 0, focused: state.focused });
    }
  });

  chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === -1) {
      await flush();
      const state = await load();
      await save({ ...state, focused: false });
      return;
    }
    const state = await load();
    if (!state.focused) {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      await save({ ...state, focused: true, since: Date.now() });
      if (tab) await beginTracking(tab);
    }
  });

  chrome.runtime.onStartup?.addListener(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab) await beginTracking(tab);
  });
}

/** Seed the very first activation after install / service-worker birth. */
export async function primeTracker() {
  const state = await load();
  if (state.tabId) return state;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) await beginTracking(tab);
  return load();
}

export async function housekeeping() {
  const removed = await pruneStats();
  const purged = await autoPurge();
  return { prunedStats: removed, purgedTrash: purged.removed };
}

/** Aggregates used by the analytics panel. */
export function analyticsSummary() {
  const stats = store.get("stats") || {};
  const entries = Object.values(stats);
  const totalForeground = entries.reduce((s, e) => s + (e.foregroundMs || 0), 0);
  const totalActivations = entries.reduce((s, e) => s + (e.activations || 0), 0);
  const bySite = new Map();
  for (const e of entries) {
    const site = e.site || siteOf(e.url) || hostname(e.url) || "其他";
    if (!bySite.has(site)) bySite.set(site, { site, foregroundMs: 0, activations: 0, pages: 0, lastVisitAt: 0 });
    const rec = bySite.get(site);
    rec.foregroundMs += e.foregroundMs || 0;
    rec.activations += e.activations || 0;
    rec.pages += 1;
    rec.lastVisitAt = Math.max(rec.lastVisitAt, e.lastVisitAt || 0);
  }
  return {
    pages: entries.length,
    totalForeground,
    totalActivations,
    sites: [...bySite.values()].sort((a, b) => b.foregroundMs - a.foregroundMs),
    topPages: entries.slice().sort((a, b) => (b.foregroundMs || 0) - (a.foregroundMs || 0)).slice(0, 20),
    mostActivated: entries.slice().sort((a, b) => (b.activations || 0) - (a.activations || 0)).slice(0, 20),
    neverUsed: entries.filter((e) => !e.activations && !e.foregroundMs).length,
  };
}
