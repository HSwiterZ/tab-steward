import { dayBucket, siteOf, hostname, urlKey, faviconFor } from "./utils.js";

const IGNORABLE = /^(chrome|edge|about|devtools|chrome-extension|chrome-search):/i;

export const RANGES = [
  { id: "today", label: "今天", days: 1 },
  { id: "week", label: "最近 7 天", days: 7 },
  { id: "month", label: "最近 30 天", days: 30 },
  { id: "quarter", label: "最近 90 天", days: 90 },
  { id: "all", label: "全部", days: 3650 },
];

export function rangeToTimestamps(rangeId = "week", reference = Date.now()) {
  const range = RANGES.find((r) => r.id === rangeId) || RANGES[1];
  const start = range.id === "today" ? new Date(reference).setHours(0, 0, 0, 0) : reference - range.days * 86400000;
  return { startTime: start, endTime: reference, days: range.days };
}

export async function queryHistory({ text = "", startTime, endTime, maxResults = 500 } = {}) {
  if (!chrome.history?.search) return [];
  const items = await chrome.history.search({ text, startTime, endTime, maxResults }).catch(() => []);
  return items.filter((i) => i.url && !IGNORABLE.test(i.url));
}

/** History grouped into 今天 / 昨天 / date buckets, newest first. */
export async function historyByRange(rangeId = "week", { text = "" } = {}) {
  const { startTime, endTime } = rangeToTimestamps(rangeId);
  const items = await queryHistory({ text, startTime, endTime, maxResults: 1000 });
  const buckets = new Map();
  for (const item of items.sort((a, b) => b.lastVisitTime - a.lastVisitTime)) {
    const label = dayBucket(item.lastVisitTime);
    if (!buckets.has(label)) buckets.set(label, { label, time: item.lastVisitTime, items: [] });
    buckets.get(label).items.push({
      id: item.id,
      title: item.title || item.url,
      url: item.url,
      host: hostname(item.url),
      site: siteOf(item.url),
      favicon: faviconFor(item.url, 32),
      visitTime: item.lastVisitTime,
      visitCount: item.visitCount || 1,
    });
  }
  return [...buckets.values()];
}

/** 常去站点: aggregate history by registrable domain. */
export async function topSites({ days = 90, limit = 30, text = "" } = {}) {
  const { startTime, endTime } = rangeToTimestamps("all", Date.now());
  const since = days >= 3650 ? startTime : Date.now() - days * 86400000;
  const items = await queryHistory({ text, startTime: Math.max(since, startTime), endTime, maxResults: 3000 });
  const map = new Map();
  const openKeys = new Set((await chrome.tabs.query({}).catch(() => [])).map((t) => urlKey(t.url)));
  const openSites = new Set((await chrome.tabs.query({}).catch(() => [])).map((t) => siteOf(t.url)));

  for (const item of items) {
    const site = siteOf(item.url);
    if (!site) continue;
    if (!map.has(site)) {
      map.set(site, {
        site,
        host: hostname(item.url),
        title: item.title || site,
        url: item.url,
        favicon: faviconFor(item.url, 32),
        visits: 0,
        entries: 0,
        lastVisitTime: 0,
        openCount: 0,
        isOpen: openSites.has(site),
      });
    }
    const rec = map.get(site);
    rec.visits += item.visitCount || 1;
    rec.entries += 1;
    rec.lastVisitTime = Math.max(rec.lastVisitTime, item.lastVisitTime || 0);
    if (openKeys.has(urlKey(item.url))) rec.openCount++;
    if ((item.visitCount || 0) > (rec.maxVisitCount || 0)) {
      rec.maxVisitCount = item.visitCount || 0;
      rec.title = item.title || rec.title;
      rec.url = item.url;
    }
  }
  return [...map.values()].sort((a, b) => b.visits - a.visits).slice(0, limit);
}

/** 常去站点中当前一个标签都没开的那些 — the "you used to read this" list. */
export async function unopenedSites(opts = {}) {
  const sites = await topSites({ ...opts, limit: 200 });
  const open = new Set((await chrome.tabs.query({}).catch(() => [])).map((t) => siteOf(t.url)));
  return sites.filter((s) => !open.has(s.site));
}

export async function recentlyClosed({ maxResults = 25 } = {}) {
  if (!chrome.sessions?.getRecentlyClosed) return { tabs: [], windows: [] };
  const sessions = await chrome.sessions.getRecentlyClosed({ maxResults }).catch(() => []);
  const tabs = [];
  const windows = [];
  for (const s of sessions) {
    if (s.tab) {
      tabs.push({
        sessionId: s.tab.sessionId,
        title: s.tab.title || s.tab.url,
        url: s.tab.url,
        host: hostname(s.tab.url),
        favicon: faviconFor(s.tab.url, 32),
        lastAccessed: s.tab.lastAccessed || Date.now(),
      });
    } else if (s.window) {
      windows.push({
        sessionId: s.window.sessionId,
        tabCount: (s.window.tabs || []).length,
        lastModified: s.window.lastModified || Date.now(),
        tabs: (s.window.tabs || []).slice(0, 12).map((t) => ({ title: t.title || t.url, url: t.url })),
      });
    }
  }
  return { tabs, windows };
}

export async function restoreSession(sessionId) {
  if (!chrome.sessions?.restore) return null;
  return chrome.sessions.restore(sessionId);
}

export async function deleteHistoryUrl(url) {
  await chrome.history?.deleteUrl?.({ url }).catch?.(() => {});
}

export async function deleteHistoryRange(rangeId) {
  const { startTime, endTime } = rangeToTimestamps(rangeId);
  await chrome.history?.deleteRange?.({ startTime, endTime }).catch?.(() => {});
}
