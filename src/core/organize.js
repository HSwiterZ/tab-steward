import { store } from "./storage.js";
import { urlKey, siteOf, hostname, groupBy } from "./utils.js";
import { addToGroup, createGroup, colorFor, listGroups } from "./actions.js";
import { listCollections } from "./collections.js";

/**
 * Reorder a window's tabs so every site's tabs sit next to each other.
 * Pinned tabs stay in front (Chrome forbids moving them behind unpinned ones)
 * and site order follows first appearance, so the result feels familiar.
 */
export async function arrangeBySite(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  const pinned = tabs.filter((t) => t.pinned).sort((a, b) => a.index - b.index);
  const rest = tabs.filter((t) => !t.pinned).sort((a, b) => a.index - b.index);

  const order = [];
  const seen = new Map();
  for (const tab of rest) {
    const site = siteOf(tab.url) || hostname(tab.url) || tab.url;
    if (!seen.has(site)) seen.set(site, []);
    seen.get(site).push(tab);
  }
  for (const group of seen.values()) for (const tab of group) order.push(tab);

  const startIndex = pinned.length;
  let moved = 0;
  for (let i = 0; i < order.length; i++) {
    const tab = order[i];
    const target = startIndex + i;
    if (tab.index !== target) {
      try {
        await chrome.tabs.move(tab.id, { windowId, index: target });
        moved++;
      } catch {
        /* index shifted underneath us; the next pass converges */
      }
    }
  }
  return { windowId, moved, sites: seen.size, total: rest.length };
}

export async function arrangeAllWindows() {
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  const results = [];
  for (const w of windows) results.push(await arrangeBySite(w.id));
  return results;
}

/**
 * Turn collections into Chrome tab groups: for every collection, the open tabs
 * whose URL is saved in it get grouped under the collection's name. Existing
 * groups with that title are reused, so repeated runs merge instead of stacking.
 */
export async function applyCollectionsAsGroups(windowId) {
  const collections = listCollections();
  const tabs = windowId == null ? await chrome.tabs.query({}) : await chrome.tabs.query({ windowId });
  const byKey = new Map();
  for (const tab of tabs) {
    const k = urlKey(tab.url);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(tab);
  }

  const report = { grouped: 0, created: 0, merged: 0, groups: [] };
  const existingGroups = await listGroups(windowId);

  for (const col of collections) {
    if (!col.items?.length) continue;
    const matched = [];
    for (const item of col.items) {
      const hits = byKey.get(urlKey(item.url)) || [];
      matched.push(...hits);
    }
    if (!matched.length) continue;

    const perWindow = groupBy(matched, (t) => t.windowId);
    for (const [wid, list] of perWindow) {
      const ids = list.map((t) => t.id);
      const existing = existingGroups.find((g) => g.windowId === wid && g.title === col.name);
      if (existing) {
        const already = new Set((await chrome.tabs.query({ groupId: existing.id })).map((t) => t.id));
        const fresh = ids.filter((id) => !already.has(id));
        if (fresh.length) {
          await chrome.tabs.group({ tabIds: fresh, groupId: existing.id }).catch(() => {});
          report.merged += fresh.length;
        }
      } else {
        const gid = await createGroup(ids, { title: col.name, color: col.color || colorFor(col.name) });
        if (gid != null) {
          existingGroups.push({ id: gid, title: col.name, windowId: wid });
          report.created++;
        }
      }
      report.grouped += ids.length;
      report.groups.push({ name: col.name, windowId: wid, count: ids.length });
    }
  }
  return report;
}

/**
 * Keep one tab in the group named after `collectionName` whenever an item is
 * favourited or reopened, so the browser's own grouping stays in sync.
 */
export async function syncGroupForUrl(url, collectionName, windowId) {
  if (!collectionName) return null;
  const key = urlKey(url);
  const tabs = await chrome.tabs.query(windowId == null ? {} : { windowId });
  const match = tabs.filter((t) => urlKey(t.url) === key);
  if (!match.length) return null;
  const settings = store.get("settings") || {};
  if (!settings.organize?.autoGroupByCollection) {
    // still group when the user explicitly asks via 整理; default is on-demand
  }
  return addToGroup(match.map((t) => t.id), { title: collectionName, windowId: match[0].windowId });
}

export async function ungroupWindow(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  const grouped = tabs.filter((t) => t.groupId > -1).map((t) => t.id);
  if (grouped.length) await chrome.tabs.ungroup(grouped).catch(() => {});
  return { ungrouped: grouped.length };
}

/**
 * Proactive tidy-up suggestions surfaced by the dashboard.
 * Pure read-only analysis — nothing is applied until the caller says so.
 */
export async function buildSuggestions({ idleThresholdMinutes = 60, minDupes = 2 } = {}) {
  const tabs = await chrome.tabs.query({});
  const stats = store.get("stats") || {};
  const sites = store.get("sites") || {};
  const threshold = idleThresholdMinutes * 60_000;
  const suggestions = [];

  const byUrl = new Map();
  for (const t of tabs) {
    const k = urlKey(t.url);
    if (!k) continue;
    if (!byUrl.has(k)) byUrl.set(k, []);
    byUrl.get(k).push(t);
  }
  const dupeGroups = [...byUrl.values()].filter((g) => g.length >= minDupes);
  if (dupeGroups.length) {
    suggestions.push({
      id: "dedupe",
      kind: "dedupe",
      icon: "copy",
      title: `发现 ${dupeGroups.length} 组重复标签`,
      detail: dupeGroups
        .slice(0, 3)
        .map((g) => g[0].title || g[0].url)
        .join("；"),
      action: { type: "dedupe.all", payload: { keep: "active" } },
      count: dupeGroups.reduce((s, g) => s + g.length - 1, 0),
    });
  }

  const idle = tabs.filter((t) => {
    if (t.active || t.pinned || t.discarded || t.audible) return false;
    const st = stats[urlKey(t.url)];
    if (sites[hostname(t.url)]?.protected) return false;
    const last = Math.max(st?.lastVisitAt || 0, t.lastAccessed || 0);
    return Date.now() - last > threshold;
  });
  if (idle.length >= 3) {
    suggestions.push({
      id: "sleep",
      kind: "sleep",
      icon: "moon",
      title: `${idle.length} 个标签闲置超过 ${idleThresholdMinutes} 分钟`,
      detail: "休眠可释放内存，标签仍在原处",
      action: { type: "sleep.tabs", payload: { tabIds: idle.map((t) => t.id) } },
      count: idle.length,
    });
  }

  const siteCounts = new Map();
  for (const t of tabs) {
    const s = siteOf(t.url);
    if (!s) continue;
    siteCounts.set(s, (siteCounts.get(s) || 0) + 1);
  }
  const scattered = [...siteCounts.entries()].filter(([, n]) => n >= 4);
  if (scattered.length) {
    suggestions.push({
      id: "arrange",
      kind: "arrange",
      icon: "sort-asc",
      title: `${scattered.length} 个站点的标签分散在各处`,
      detail: scattered
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([s, n]) => `${s} (${n})`)
        .join("、"),
      action: { type: "organize.arrange", payload: { scope: "all" } },
      count: scattered.length,
    });
  }

  const stashed = listCollections().flatMap((c) => c.items || []);
  const stashedKeys = new Set(stashed.map((i) => urlKey(i.url)));
  const groupable = tabs.filter((t) => stashedKeys.has(urlKey(t.url)) && t.groupId === -1);
  if (groupable.length >= 2) {
    suggestions.push({
      id: "group",
      kind: "group",
      icon: "layers",
      title: `${groupable.length} 个已收藏的标签还没归入分组`,
      detail: "按收藏区归属创建 Chrome 标签组",
      action: { type: "organize.groups", payload: { scope: "all" } },
      count: groupable.length,
    });
  }

  return suggestions;
}
