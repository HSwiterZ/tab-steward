import { store } from "./storage.js";
import { urlKey, siteOf, hostname, now as ts } from "./utils.js";
import { enrichTab, resetIdleFor } from "./stats.js";

/* ====================================================================== *
 * Low-level tab / window operations shared by popup and dashboard.
 * Every function returns a plain result so callers decide how to report it.
 * ====================================================================== */

const NORMAL_WINDOW_TYPES = ["normal"];

export async function getAllWindows({ populate = true, includePopups = true } = {}) {
  const wins = await chrome.windows.getAll({ populate });
  return includePopups ? wins : wins.filter((w) => NORMAL_WINDOW_TYPES.includes(w.type));
}

export async function getAllTabs({ includePopups = true } = {}) {
  const tabs = await chrome.tabs.query({});
  if (includePopups) return tabs;
  const wins = await chrome.windows.getAll({});
  const normal = new Set(wins.filter((w) => NORMAL_WINDOW_TYPES.includes(w.type)).map((w) => w.id));
  return tabs.filter((t) => normal.has(t.windowId));
}

export async function currentWindow() {
  try {
    return await chrome.windows.getLastFocused({ populate: false, windowTypes: ["normal"] });
  } catch {
    return chrome.windows.getLastFocused({});
  }
}

/**
 * Activate a tab and bring its window forward.
 *
 * Only a minimised window gets its state changed: passing `state: "normal"`
 * un-maximises, which drops a maximised window back to its restored bounds.
 */
export async function focusTab(tabId, windowId) {
  if (windowId != null) {
    try {
      const win = await chrome.windows.get(windowId);
      await chrome.windows.update(windowId, win.state === "minimized" ? { focused: true, state: "normal" } : { focused: true });
    } catch {
      await chrome.windows.update(windowId, { focused: true }).catch(() => {});
    }
  }
  await chrome.tabs.update(tabId, { active: true });
  return { ok: true, tabId };
}

/**
 * chrome.tabs.remove rejects the whole batch as soon as one id is already gone,
 * so a stale id must not cost the user every other close in the batch. Ids that
 * no longer exist are treated as done; only a genuine refusal is reported.
 */
export async function removeTabsResilient(tabIds) {
  const ids = [...new Set(tabIds)].filter((id) => id != null);
  if (!ids.length) return { closed: [], failed: [] };
  try {
    await chrome.tabs.remove(ids);
    return { closed: ids, failed: [] };
  } catch {
    // The batch aborted partway through, so judge every id by where it ended up.
    const closed = [];
    const failed = [];
    for (const id of ids) {
      const gone = await chrome.tabs.get(id).then(() => false, () => true);
      if (gone) {
        closed.push(id);
        continue;
      }
      try {
        await chrome.tabs.remove(id);
        closed.push(id);
      } catch {
        failed.push(id);
      }
    }
    return { closed, failed };
  }
}

export async function closeTabs(tabIds) {
  const ids = [...new Set(tabIds)].filter((id) => id != null);
  if (!ids.length) return { closed: 0, failed: [] };
  const snapshot = [];
  for (const id of ids) {
    try {
      snapshot.push(await chrome.tabs.get(id));
    } catch {
      /* already gone */
    }
  }
  const { closed, failed } = await removeTabsResilient(ids);
  const existed = new Set(snapshot.map((t) => t.id));
  return { closed: closed.filter((id) => existed.has(id)).length, snapshot, failed };
}

export async function closeSite(site, { windowId } = {}) {
  const tabs = await getAllTabs();
  const ids = tabs.filter((t) => (siteOf(t.url) === site || hostname(t.url) === site) && (windowId == null || t.windowId === windowId)).map((t) => t.id);
  return closeTabs(ids);
}

/** chrome.tabs.discard keeps the tab but frees its renderer. */
export async function sleepTabs(tabIds, { force = false } = {}) {
  const ids = [...new Set(tabIds)];
  const slept = [];
  const skipped = [];
  for (const id of ids) {
    let tab;
    try {
      tab = await chrome.tabs.get(id);
    } catch {
      continue;
    }
    if (!force && !canSleep(tab)) {
      skipped.push({ tab, reason: skipReason(tab) });
      continue;
    }
    if (tab.discarded) continue;
    try {
      await chrome.tabs.discard(id);
      slept.push(id);
      const stats = { ...(store.get("stats") || {}) };
      const k = urlKey(tab.url);
      if (stats[k]) {
        stats[k] = { ...stats[k], lastSleepAt: ts(), discardCount: (stats[k].discardCount || 0) + 1 };
        await store.set("stats", stats);
      }
    } catch (err) {
      skipped.push({ tab, reason: String(err?.message || err) });
    }
  }
  return { slept: slept.length, sleptIds: slept, skipped };
}

export function canSleep(tab) {
  if (!tab || tab.active || tab.pinned || tab.discarded || tab.audible) return false;
  if (/^(chrome|edge|about|devtools|chrome-extension):/.test(tab.url || "")) return false;
  const sites = store.get("sites") || {};
  if (sites[hostname(tab.url)]?.protected) return false;
  return true;
}

export function skipReason(tab) {
  if (!tab) return "标签不存在";
  if (tab.active) return "正在使用";
  if (tab.pinned) return "已固定";
  if (tab.audible) return "正在播放声音";
  if (tab.discarded) return "已休眠";
  if (/^(chrome|edge|about|devtools|chrome-extension):/.test(tab.url || "")) return "浏览器内部页";
  if ((store.get("sites") || {})[hostname(tab.url)]?.protected) return "受保护站点";
  return "无法休眠";
}

export async function wakeTabs(tabIds) {
  let woken = 0;
  for (const id of tabIds) {
    try {
      const tab = await chrome.tabs.get(id);
      if (!tab.discarded) continue;
      await chrome.tabs.reload(id);
      woken++;
    } catch {
      /* ignore */
    }
  }
  return { woken };
}

export async function sleepSite(site, { windowId } = {}) {
  const tabs = await getAllTabs();
  const ids = tabs.filter((t) => siteOf(t.url) === site && (windowId == null || t.windowId === windowId)).map((t) => t.id);
  return sleepTabs(ids);
}

export async function moveTabsToNewWindow(tabIds) {
  const ids = [...new Set(tabIds)];
  if (!ids.length) return null;
  const first = await chrome.tabs.get(ids[0]);
  const win = await chrome.windows.create({ tabId: ids[0], focused: true });
  const rest = ids.slice(1);
  if (rest.length) {
    await chrome.tabs.move(rest, { windowId: win.id, index: -1 });
  }
  void first;
  return win;
}

export async function moveTabsToWindow(tabIds, windowId, index = -1) {
  const ids = [...new Set(tabIds)];
  if (!ids.length) return { moved: 0 };
  await chrome.tabs.move(ids, { windowId, index });
  return { moved: ids.length };
}

export async function duplicateTab(tabId) {
  return chrome.tabs.duplicate(tabId);
}

export async function pinTabs(tabIds, pinned) {
  for (const id of tabIds) await chrome.tabs.update(id, { pinned }).catch(() => {});
  return { count: tabIds.length, pinned };
}

export async function muteTabs(tabIds, muted) {
  for (const id of tabIds) await chrome.tabs.update(id, { muted }).catch(() => {});
  return { count: tabIds.length, muted };
}

export async function reloadTabs(tabIds) {
  for (const id of tabIds) await chrome.tabs.reload(id).catch(() => {});
  return { count: tabIds.length };
}

/* ====================================================================== *
 * Windows
 * ====================================================================== */

export async function nameWindow(windowId, name) {
  const windows = { ...(store.get("windows") || {}) };
  windows[windowId] = { ...(windows[windowId] || {}), name: name || "" };
  await store.set("windows", windows);
  return windows[windowId];
}

export async function setWindowCollapsed(windowId, collapsed) {
  const windows = { ...(store.get("windows") || {}) };
  windows[windowId] = { ...(windows[windowId] || {}), collapsed: !!collapsed };
  await store.set("windows", windows);
  return windows[windowId];
}

/**
 * 1-based position of each normal window, used as its display number. Chrome's
 * window ids are large unstable numbers that mean nothing to a user.
 */
export function windowOrdinals(windows) {
  const map = new Map();
  windows.filter((w) => w.type === "normal").sort((a, b) => a.id - b.id).forEach((w, i) => map.set(w.id, i + 1));
  return map;
}

export function windowLabel(win, stored, ordinal) {
  if (stored?.name) return stored.name;
  if (win.type === "popup") return "弹出窗口";
  if (win.incognito) return "无痕窗口";
  return ordinal == null ? "窗口" : `窗口 ${ordinal}`;
}

export async function closeWindow(windowId) {
  await chrome.windows.remove(windowId);
  return { ok: true };
}

export async function minimizeWindow(windowId) {
  return chrome.windows.update(windowId, { state: "minimized" });
}

export async function focusWindow(windowId) {
  return chrome.windows.update(windowId, { focused: true, drawAttention: true });
}

/* ====================================================================== *
 * Site-level flags (pinned to top / protected from sleep & close)
 * ====================================================================== */

export async function setSiteFlag(host, flag, value) {
  const sites = { ...(store.get("sites") || {}) };
  const cur = sites[host] || {};
  sites[host] = { ...cur, host, [flag]: !!value, updatedAt: ts() };
  if (!sites[host].pinned && !sites[host].protected && !sites[host].note) delete sites[host];
  await store.set("sites", sites);
  return sites[host] || null;
}

export const pinSite = (host, on = true) => setSiteFlag(host, "pinned", on);
export const protectSite = (host, on = true) => setSiteFlag(host, "protected", on);

/* ====================================================================== *
 * Card lock — disables close/sleep/etc. for a site card
 * ====================================================================== */

export async function setCardLocked(site, locked) {
  const list = new Set(store.get("lockedCards") || []);
  if (locked) list.add(site);
  else list.delete(site);
  await store.set("lockedCards", [...list]);
  return [...list];
}

export const isCardLocked = (site) => (store.get("lockedCards") || []).includes(site);

/* ====================================================================== *
 * Chrome tab groups
 * ====================================================================== */

export const GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];

export async function listGroups(windowId) {
  return chrome.tabGroups.query(windowId == null ? {} : { windowId });
}

export async function createGroup(tabIds, { title, color, collapsed } = {}) {
  if (!tabIds.length) return null;
  const groupId = await chrome.tabs.group({ tabIds });
  await chrome.tabGroups.update(groupId, {
    title: title || "",
    color: color && GROUP_COLORS.includes(color) ? color : colorFor(title || ""),
    collapsed: !!collapsed,
  });
  return groupId;
}

export function colorFor(seed) {
  const s = String(seed || "");
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum = (sum * 31 + s.charCodeAt(i)) >>> 0;
  return GROUP_COLORS[sum % GROUP_COLORS.length];
}

export async function ungroupTabs(tabIds) {
  if (!tabIds.length) return;
  await chrome.tabs.ungroup(tabIds);
}

export async function findGroupByTitle(title, windowId) {
  const groups = await listGroups(windowId);
  return groups.find((g) => g.title === title) || null;
}

/** Add tabs to an existing group, creating it when absent. Returns the group id. */
export async function addToGroup(tabIds, { title, color, windowId, collapsed } = {}) {
  if (!tabIds.length) return null;
  const existing = title ? await findGroupByTitle(title, windowId) : null;
  if (existing) {
    const groupId = await chrome.tabs.group({ tabIds, groupId: existing.id });
    return groupId;
  }
  return createGroup(tabIds, { title, color, collapsed });
}

/* ====================================================================== *
 * Misc
 * ====================================================================== */

export async function openUrl(url, { windowId, active = true, background = false } = {}) {
  return chrome.tabs.create({ url, windowId, active: background ? false : active });
}

export async function openUrls(urls, { newWindow = false } = {}) {
  if (!urls.length) return [];
  if (newWindow) {
    const win = await chrome.windows.create({ url: urls.slice(0, 8), focused: true });
    for (const u of urls.slice(8)) await chrome.tabs.create({ url: u, windowId: win.id, active: false });
    return [win];
  }
  const win = await currentWindow();
  const created = [];
  for (const u of urls) created.push(await chrome.tabs.create({ url: u, windowId: win?.id, active: false }));
  return created;
}

export const resetIdle = (urls) => resetIdleFor(urls);

/** Decorate a raw tab list with stats + site flags, in one pass. */
export function decorate(tabs, reference = Date.now()) {
  const stats = store.get("stats") || {};
  const sites = store.get("sites") || {};
  return tabs.map((t) => enrichTab(t, { stats, sites, now: reference }));
}

export function notifyBroadcast(type, payload = {}) {
  chrome.runtime.sendMessage({ type, payload }).catch(() => {});
}
