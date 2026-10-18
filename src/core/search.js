import { store } from "./storage.js";
import { isOn } from "./modules.js";
import { urlKey, hostname, siteOf, formatRelative, dayBucket, faviconFor } from "./utils.js";
import { enrichTab } from "./stats.js";
import { allItems } from "./collections.js";
import { getAllWindows, windowOrdinals } from "./actions.js";

export const SOURCES = [
  { id: "tab", label: "已打开标签", short: "标签", icon: "app-window" },
  { id: "stash", label: "暂存与收藏", short: "暂存", icon: "layers" },
  { id: "bookmark", label: "书签", short: "书签", icon: "bookmark" },
  { id: "history", label: "浏览历史", short: "历史", icon: "history" },
  { id: "closed", label: "最近关闭", short: "最近关闭", icon: "rotate-ccw" },
];

/** Sources the palette may offer right now — a disabled module removes its chips. */
export function availableSources(settings = store.get("settings") || {}) {
  const library = isOn(settings, "library");
  return SOURCES.filter((s) => library || s.id === "tab" || s.id === "stash");
}

const SOURCE_LABEL = Object.fromEntries(SOURCES.map((s) => [s.id, s.label]));

/**
 * Score how well a candidate matches the query. Higher is better; 0 means no match.
 * Prefix matches beat substring matches so typing "git" surfaces github first.
 */
function score(title = "", url = "", q) {
  const t = title.toLowerCase();
  const u = url.toLowerCase();
  const host = hostname(url);
  let s = 0;
  if (t === q) s += 120;
  if (t.startsWith(q)) s += 80;
  else if (t.includes(q)) s += 50;
  if (host.startsWith(q)) s += 60;
  else if (host.includes(q)) s += 34;
  if (u.includes(q)) s += 22;
  if (siteOf(url) === q) s += 40;
  // token match: every whitespace-separated term must appear somewhere
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((tk) => t.includes(tk) || u.includes(tk))) s += 45;
  return s;
}

export async function searchTabs(query, ordinals) {
  const tabs = await chrome.tabs.query({});
  const seq = ordinals || windowOrdinals(await getAllWindows({ populate: false }));
  const stats = store.get("stats") || {};
  const sites = store.get("sites") || {};
  const q = query.toLowerCase();
  const out = [];
  for (const tab of tabs) {
    const s = score(tab.title || "", tab.url || "", q);
    if (!s) continue;
    const e = enrichTab(tab, { stats, sites });
    out.push({
      source: "tab",
      id: `tab-${tab.id}`,
      title: tab.title || tab.url,
      url: tab.url,
      favicon: faviconFor(tab.url, 32),
      score: s + (tab.active ? 12 : 0) + (e.discarded ? 0 : 4),
      meta: [windowName(tab.windowId, seq), tab.discarded ? "已休眠" : null, tab.pinned ? "已固定" : null].filter(Boolean).join(" · "),
      payload: { tabId: tab.id, windowId: tab.windowId },
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function searchStash(query) {
  const q = query.toLowerCase();
  const out = [];
  for (const item of allItems()) {
    const base = score(item.title || "", item.url || "", q);
    const noteHit = (item.note || "").toLowerCase().includes(q) ? 18 : 0;
    if (!base && !noteHit) continue;
    out.push({
      source: "stash",
      id: `stash-${item.id}`,
      title: item.title,
      url: item.url,
      favicon: faviconFor(item.url, 32),
      score: base + noteHit,
      meta: `${item.collectionName} · ${formatRelative(item.addedAt)}`,
      payload: { itemId: item.id, collectionId: item.collectionId },
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

export async function searchBookmarks(query) {
  if (!chrome.bookmarks?.search) return [];
  const results = await chrome.bookmarks.search(query).catch(() => []);
  const q = query.toLowerCase();
  return results
    .filter((r) => r.url)
    .map((r) => ({
      source: "bookmark",
      id: `bm-${r.id}`,
      title: r.title || r.url,
      url: r.url,
      favicon: faviconFor(r.url, 32),
      score: score(r.title || "", r.url || "", q) + 6,
      meta: hostname(r.url),
      payload: { bookmarkId: r.id },
    }))
    .sort((a, b) => b.score - a.score);
}

export async function searchHistory(query, { days = 90, max = 40 } = {}) {
  if (!chrome.history?.search) return [];
  const items = await chrome.history
    .search({ text: query, startTime: Date.now() - days * 86400000, maxResults: max })
    .catch(() => []);
  const q = query.toLowerCase();
  const openUrls = new Set((await chrome.tabs.query({}).catch(() => [])).map((t) => urlKey(t.url)));
  return items
    .filter((i) => i.url && !/^(chrome|edge|about|chrome-extension):/.test(i.url))
    .map((i) => ({
      source: "history",
      id: `hist-${i.id}`,
      title: i.title || i.url,
      url: i.url,
      favicon: faviconFor(i.url, 32),
      score: score(i.title || "", i.url || "", q) + Math.min(20, Math.log2((i.visitCount || 1) + 1) * 4) + (openUrls.has(urlKey(i.url)) ? -30 : 0),
      meta: `${dayBucket(i.lastVisitTime)} · 访问 ${i.visitCount || 1} 次${openUrls.has(urlKey(i.url)) ? " · 已打开" : ""}`,
      payload: { visitTime: i.lastVisitTime, alreadyOpen: openUrls.has(urlKey(i.url)) },
    }))
    .sort((a, b) => b.score - a.score);
}

export async function searchClosed(query) {
  if (!chrome.sessions?.getRecentlyClosed) return [];
  const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 25 }).catch(() => []);
  const q = query.toLowerCase();
  const out = [];
  for (const s of sessions) {
    const tab = s.tab;
    if (!tab) continue;
    const sc = score(tab.title || "", tab.url || "", q);
    if (!sc) continue;
    out.push({
      source: "closed",
      id: `closed-${tab.sessionId}`,
      title: tab.title || tab.url,
      url: tab.url,
      favicon: faviconFor(tab.url, 32),
      score: sc,
      meta: `关闭于 ${formatRelative(tab.lastAccessed || Date.now())}`,
      payload: { sessionId: tab.sessionId },
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

const SOURCE_WEIGHT = { tab: 0, stash: 6, bookmark: 12, closed: 18, history: 24 };

/**
 * Run every enabled source in parallel and return both a flat, interleaved
 * list (for the ⌘K palette) and per-source buckets (for grouped rendering).
 */
export async function unifiedSearch(rawQuery, opts = {}) {
  const query = String(rawQuery || "").trim();
  const settings = store.get("settings") || {};
  const cfg = { includeTabs: true, includeStash: true, includeBookmarks: true, includeHistory: true, includeClosed: true, historyDays: 90, maxResultsPerSource: 8, ...(settings.search || {}), ...opts };
  // A disabled module outranks the per-source preference that lives inside it.
  if (!isOn(settings, "library")) {
    cfg.includeBookmarks = false;
    cfg.includeHistory = false;
    cfg.includeClosed = false;
  }
  if (!query) return { query, groups: {}, flat: [], total: 0 };

  const ordinals = windowOrdinals(await getAllWindows({ populate: false }));
  const [tabs, stash, bookmarks, history, closed] = await Promise.all([
    cfg.includeTabs ? searchTabs(query, ordinals) : [],
    cfg.includeStash ? Promise.resolve(searchStash(query)) : [],
    cfg.includeBookmarks ? searchBookmarks(query) : [],
    cfg.includeHistory ? searchHistory(query, { days: cfg.historyDays }) : [],
    cfg.includeClosed ? searchClosed(query) : [],
  ]);

  const perSource = cfg.maxResultsPerSource || 8;
  const groups = {
    tab: tabs.slice(0, perSource),
    stash: stash.slice(0, perSource),
    bookmark: bookmarks.slice(0, perSource),
    history: history.slice(0, perSource),
    closed: closed.slice(0, perSource),
  };

  // A query often matches bookmark/history titles without matching the title of the
  // already-open tab on that same site (a saved "Foo 控制台" vs a live tab titled
  // "Dashboard") — surface those open tabs too, flagged.
  if (cfg.includeTabs && !groups.tab.length) {
    const hosts = new Set(
      [...groups.bookmark, ...groups.history, ...groups.stash, ...groups.closed].map((r) => hostname(r.url)).filter(Boolean)
    );
    if (hosts.size) {
      const openTabs = await chrome.tabs.query({});
      groups.tab = openTabs
        .filter((t) => hosts.has(hostname(t.url)))
        .slice(0, perSource)
        .map((t) => ({
          source: "tab",
          id: `tab-${t.id}`,
          title: t.title || t.url,
          url: t.url,
          favicon: faviconFor(t.url, 32),
          score: 28,
          sameSite: true,
          meta: `同站点已打开 · ${windowName(t.windowId, ordinals)}${t.discarded ? " · 已休眠" : ""}`,
          payload: { tabId: t.id, windowId: t.windowId },
        }));
    }
  }

  const flat = Object.entries(groups)
    .flatMap(([source, list]) => list.map((r) => ({ ...r, sortScore: r.score - SOURCE_WEIGHT[source] })))
    .sort((a, b) => b.sortScore - a.sortScore);

  return {
    query,
    groups,
    flat,
    total: flat.length,
    counts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
  };
}

/* ------------------------------------------------------------------ *
 * recent / frequent searches
 * ------------------------------------------------------------------ */

export function recentSearches() {
  return (store.get("searches") || {}).recent || [];
}

export function frequentSearches() {
  const freq = (store.get("searches") || {}).frequent || {};
  return Object.entries(freq)
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

export async function recordSearch(query) {
  const q = String(query || "").trim();
  if (!q || q.length < 2) return;
  const searches = store.get("searches") || { recent: [], frequent: {} };
  const recent = [q, ...(searches.recent || []).filter((x) => x !== q)].slice(0, 12);
  const frequent = { ...(searches.frequent || {}) };
  frequent[q] = (frequent[q] || 0) + 1;
  const trimmedFrequent = Object.fromEntries(
    Object.entries(frequent)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
  );
  await store.set("searches", { recent, frequent: trimmedFrequent });
}

export async function clearRecentSearches() {
  const searches = store.get("searches") || {};
  await store.set("searches", { ...searches, recent: [] });
}

export async function forgetSearch(query) {
  const searches = store.get("searches") || {};
  await store.set("searches", {
    ...searches,
    recent: (searches.recent || []).filter((x) => x !== query),
  });
}

export function windowName(windowId, ordinals) {
  const stored = (store.get("windows") || {})[windowId];
  if (stored?.name) return stored.name;
  const ordinal = ordinals?.get(windowId);
  return ordinal == null ? "窗口" : `窗口 ${ordinal}`;
}

export { SOURCE_LABEL };
