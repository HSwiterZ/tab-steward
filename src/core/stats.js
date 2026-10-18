import { store } from "./storage.js";
import { urlKey, siteOf, hostname, clamp } from "./utils.js";

/* ------------------------------------------------------------------ *
 * Usage stats shape
 *   stats[urlKey] = {
 *     url, title, host, site,
 *     foregroundMs, activations, lastVisitAt, firstVisitAt,
 *     openedAt, lastDiscardAt, discardCount, lastSleepAt
 *   }
 * ------------------------------------------------------------------ */

export function emptyStat(url, title = "") {
  const t = Date.now();
  return {
    url,
    title,
    host: hostname(url),
    site: siteOf(url),
    foregroundMs: 0,
    activations: 0,
    lastVisitAt: 0,
    firstVisitAt: t,
    openedAt: t,
    lastDiscardAt: 0,
    discardCount: 0,
    lastSleepAt: 0,
  };
}

export function getStats() {
  return store.get("stats") || {};
}

export function statFor(url) {
  const all = getStats();
  return all[urlKey(url)] || null;
}

export async function recordStat(url, patch, { additive = [] } = {}) {
  const key = urlKey(url);
  if (!key) return null;
  const all = { ...(store.get("stats") || {}) };
  const prev = all[key] || emptyStat(url);
  const next = { ...prev, ...patch };
  for (const field of additive) next[field] = (Number(prev[field]) || 0) + (Number(patch[field]) || 0);
  if (patch.title) next.title = patch.title;
  if (!next.host) next.host = hostname(url);
  if (!next.site) next.site = siteOf(url);
  all[key] = next;
  await store.set("stats", all);
  return next;
}

export async function bumpActivation(url, when = Date.now()) {
  const key = urlKey(url);
  if (!key) return null;
  const all = { ...(store.get("stats") || {}) };
  const prev = all[key] || emptyStat(url, when);
  all[key] = {
    ...prev,
    activations: (prev.activations || 0) + 1,
    lastVisitAt: when,
    firstVisitAt: prev.firstVisitAt || when,
  };
  await store.set("stats", all);
  return all[key];
}

export async function addForeground(url, ms) {
  if (ms <= 0) return null;
  const key = urlKey(url);
  if (!key) return null;
  const all = { ...(store.get("stats") || {}) };
  const prev = all[key] || emptyStat(url);
  all[key] = { ...prev, foregroundMs: (prev.foregroundMs || 0) + ms };
  await store.set("stats", all);
  return all[key];
}

/** Drop stats for URLs that no longer appear anywhere and are older than `maxAgeMs`. */
export async function pruneStats({ maxAgeMs = 90 * 24 * 3600 * 1000, limit = 4000 } = {}) {
  const all = getStats();
  const keys = Object.keys(all);
  if (keys.length <= limit) return 0;
  const cutoff = Date.now() - maxAgeMs;
  const scored = keys
    .map((k) => ({ k, at: Math.max(all[k].lastVisitAt || 0, all[k].firstVisitAt || 0) }))
    .sort((a, b) => a.at - b.at);
  const next = { ...all };
  let removed = 0;
  for (const { k, at } of scored) {
    if (keys.length - removed <= limit) break;
    if (at > cutoff && removed < keys.length - limit) continue;
    delete next[k];
    removed++;
  }
  if (removed) await store.set("stats", next);
  return removed;
}

export async function resetIdleFor(urls) {
  const all = { ...(store.get("stats") || {}) };
  const t = Date.now();
  for (const u of urls) {
    const k = urlKey(u);
    if (all[k]) all[k] = { ...all[k], lastVisitAt: t, idleResetAt: t };
  }
  await store.set("stats", all);
  return t;
}

/* ------------------------------------------------------------------ *
 * Idle model
 * ------------------------------------------------------------------ */

export const IDLE_BANDS = [
  { id: "active", label: "活跃", max: 20, tone: "success" },
  { id: "low", label: "低闲置", max: 45, tone: "info" },
  { id: "medium", label: "中闲置", max: 70, tone: "secondary" },
  { id: "high", label: "高闲置", max: 90, tone: "warning" },
  { id: "severe", label: "极高闲置", max: 101, tone: "destructive" },
];

/**
 * Idle score 0..100 from how long the page has been out of the foreground.
 * Log-ish bands so a tab idle for a day is clearly worse than one idle for an
 * hour, without a linear scale making everything past 3h look identical.
 */
export function idleScore(idleMs) {
  const mins = Math.max(0, idleMs) / 60000;
  if (mins < 15) return Math.round((mins / 15) * 20);
  if (mins < 60) return 20 + Math.round(((mins - 15) / 45) * 25);
  if (mins < 360) return 45 + Math.round(((mins - 60) / 300) * 25);
  if (mins < 1440) return 70 + Math.round(((mins - 360) / 1080) * 20);
  return clamp(90 + Math.round(Math.log2(mins / 1440 + 1) * 4), 90, 100);
}

export function bandForScore(score) {
  return IDLE_BANDS.find((b) => score < b.max) || IDLE_BANDS[IDLE_BANDS.length - 1];
}

/**
 * Resolve the effective "last touched" timestamp for a tab, preferring our own
 * tracker and falling back to chrome.tabs' lastAccessed (Chrome 121+).
 */
export function lastTouchAt(tab, stat, reference = Date.now()) {
  const candidates = [
    stat?.lastVisitAt || 0,
    stat?.idleResetAt || 0,
    tab?.lastAccessed || 0,
    tab?.discarded ? stat?.lastSleepAt || 0 : 0,
  ].filter(Boolean);
  if (!candidates.length) return reference;
  return Math.min(reference, Math.max(...candidates));
}

export function idleMsFor(tab, stat, reference = Date.now()) {
  if (tab?.active) return 0;
  return Math.max(0, reference - lastTouchAt(tab, stat, reference));
}

/** A fully decorated tab, ready for sorting/rendering. */
export function enrichTab(tab, { stats = getStats(), sites = store.get("sites") || {}, now = Date.now() } = {}) {
  const key = urlKey(tab.url);
  const stat = stats[key] || null;
  const site = siteOf(tab.url) || hostname(tab.url) || "其他";
  const host = hostname(tab.url);
  const siteInfo = sites[host] || {};
  const idleMs = idleMsFor(tab, stat, now);
  const score = tab.active ? 0 : idleScore(idleMs);
  return {
    ...tab,
    key,
    site,
    host,
    stat,
    idleMs,
    idleScore: score,
    idleBand: bandForScore(score),
    foregroundMs: stat?.foregroundMs || 0,
    activations: stat?.activations || 0,
    firstVisitAt: stat?.firstVisitAt || 0,
    lastVisitAt: Math.max(stat?.lastVisitAt || 0, tab.lastAccessed || 0),
    pinnedSite: !!siteInfo.pinned,
    protectedSite: !!siteInfo.protected,
    isExtensionPage: /^(chrome|edge|about|chrome-extension|devtools):/.test(tab.url || ""),
    isSleepable: !tab.active && !tab.pinned && !tab.discarded && !tab.audible && !siteInfo.protected,
  };
}

export function enrichTabs(tabs, opts) {
  const stats = (opts?.stats ?? store.get("stats")) || {};
  const sites = (opts?.sites ?? store.get("sites")) || {};
  const now = opts?.now ?? Date.now();
  return tabs.map((t) => enrichTab(t, { stats, sites, now }));
}

/* ------------------------------------------------------------------ *
 * Sorting — the five orders exposed in the UI
 * ------------------------------------------------------------------ */

export const SORTERS = {
  idle: (a, b) => b.idleScore - a.idleScore || a.site.localeCompare(b.site),
  recent: (a, b) => b.lastVisitAt - a.lastVisitAt,
  usage: (a, b) => b.foregroundMs - a.foregroundMs || a.site.localeCompare(b.site),
  count: (a, b) => (b._siteCount || 0) - (a._siteCount || 0) || a.site.localeCompare(b.site) || b.idleScore - a.idleScore,
  title: (a, b) => a.site.localeCompare(b.site, "zh-Hans-CN") || (a.title || "").localeCompare(b.title || "", "zh-Hans-CN"),
};

/** Site cards get their own ordering; `count` needs the per-site tally first. */
export function sortSites(sites, sortId = "idle") {
  const list = [...sites];
  switch (sortId) {
    case "recent":
      return list.sort((a, b) => b.lastVisitAt - a.lastVisitAt);
    case "usage":
      return list.sort((a, b) => b.foregroundMs - a.foregroundMs || b.maxIdle - a.maxIdle);
    case "count":
      return list.sort((a, b) => b.tabs.length - a.tabs.length || b.maxIdle - a.maxIdle);
    case "title":
      return list.sort((a, b) => a.site.localeCompare(b.site, "zh-Hans-CN"));
    case "idle":
    default:
      return list.sort((a, b) => b.avgIdle - a.avgIdle || b.tabs.length - a.tabs.length);
  }
}

/** Collapse enriched tabs into per-site cards. */
export function buildSiteCards(enrichedTabs) {
  const map = new Map();
  for (const tab of enrichedTabs) {
    const key = tab.site || "其他";
    if (!map.has(key)) {
      map.set(key, {
        site: key,
        host: tab.host,
        tabs: [],
        foregroundMs: 0,
        activations: 0,
        lastVisitAt: 0,
        firstVisitAt: 0,
        maxIdle: 0,
        avgIdle: 0,
        idleScore: 0,
        discarded: 0,
        pinned: 0,
        audible: 0,
        windowIds: new Set(),
        groupIds: new Set(),
      });
    }
    const card = map.get(key);
    card.tabs.push(tab);
    card.foregroundMs += tab.foregroundMs;
    card.activations += tab.activations;
    card.lastVisitAt = Math.max(card.lastVisitAt, tab.lastVisitAt);
    card.firstVisitAt = card.firstVisitAt ? Math.min(card.firstVisitAt, tab.firstVisitAt || card.firstVisitAt) : tab.firstVisitAt;
    card.maxIdle = Math.max(card.maxIdle, tab.idleScore);
    card.windowIds.add(tab.windowId);
    if (tab.groupId > -1) card.groupIds.add(tab.groupId);
    if (tab.discarded) card.discarded++;
    if (tab.pinned) card.pinned++;
    if (tab.audible) card.audible++;
  }
  for (const card of map.values()) {
    card.avgIdle = Math.round(card.tabs.reduce((s, t) => s + t.idleScore, 0) / Math.max(1, card.tabs.length));
    card.idleScore = card.avgIdle;
    card.idleBand = bandForScore(card.avgIdle);
    card.tabs.sort((a, b) => b.idleScore - a.idleScore);
    card.hasActive = card.tabs.some((t) => t.active);
    card.dupeCount = card.tabs.length - new Set(card.tabs.map((t) => t.key)).size;
  }
  return [...map.values()];
}
