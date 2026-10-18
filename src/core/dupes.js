import { store } from "./storage.js";
import { urlKey, siteOf, hostname } from "./utils.js";
import { removeTabsResilient, getAllWindows, windowLabel, windowOrdinals } from "./actions.js";

const SESSION_KEY = "dupeSuppressUntil";

/**
 * Bulk operations (restoring a snapshot, opening a whole collection) create
 * many tabs at once and would otherwise each trip the duplicate prompt.
 */
export async function suppressFor(ms = 4000) {
  const until = Date.now() + ms;
  await chrome.storage?.session?.set?.({ [SESSION_KEY]: until }).catch?.(() => {});
  return until;
}

export async function isSuppressed(reference = Date.now()) {
  const raw = await chrome.storage?.session?.get?.(SESSION_KEY).catch?.(() => null);
  const until = raw?.[SESSION_KEY] || 0;
  return until > reference;
}

const IGNORABLE = /^(chrome|edge|about|devtools|chrome-extension|chrome-search|view-source):/i;

export function isTrackable(url) {
  return !!url && !IGNORABLE.test(url);
}

/**
 * Group tabs by normalised URL. Only groups with 2+ tabs are duplicates.
 * `keep` decides the survivor: 'active' (default), 'first' or 'newest'.
 */
export function findDuplicateGroups(tabs, { keep = "active", minGroup = 2 } = {}) {
  const map = new Map();
  for (const tab of tabs) {
    if (!isTrackable(tab.url)) continue;
    const key = urlKey(tab.url);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(tab);
  }

  const groups = [];
  for (const [key, list] of map) {
    if (list.length < minGroup) continue;
    const sorted = [...list].sort((a, b) => a.windowId - b.windowId || a.index - b.index);
    let keeper;
    if (keep === "active") {
      keeper =
        sorted.find((t) => t.active) ||
        sorted.find((t) => !t.discarded && !t.pinned) ||
        sorted.find((t) => !t.discarded) ||
        sorted[0];
    } else if (keep === "newest") {
      keeper = [...sorted].sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    } else {
      keeper = sorted.find((t) => t.pinned) || sorted[0];
    }
    groups.push({
      key,
      url: keeper.url,
      title: keeper.title || keeper.url,
      site: siteOf(keeper.url),
      host: hostname(keeper.url),
      tabs: sorted,
      keepId: keeper.id,
      removable: sorted.filter((t) => t.id !== keeper.id && !t.pinned).map((t) => t.id),
      windows: [...new Set(sorted.map((t) => t.windowId))],
    });
  }
  return groups.sort((a, b) => b.tabs.length - a.tabs.length);
}

export async function scanDuplicates({ windowId, scope = "all", keep = "active" } = {}) {
  const query = windowId != null ? { windowId } : scope === "current" ? { currentWindow: true } : {};
  const tabs = await chrome.tabs.query(query);
  return findDuplicateGroups(tabs, { keep });
}

/** Mark duplicate tabs for rendering without closing anything. */
export async function markDuplicates({ windowId } = {}) {
  const tabs = await chrome.tabs.query(windowId == null ? {} : { windowId });
  const groups = findDuplicateGroups(tabs);
  const marks = new Map();
  for (const g of groups) {
    for (const t of g.tabs) {
      marks.set(t.id, { key: g.key, isKeeper: t.id === g.keepId, count: g.tabs.length, title: g.title });
    }
  }
  return { groups, marks };
}

/**
 * Close duplicates and hand back an undo snapshot so the caller can offer
 * "撤销" — closing tabs is destructive and must be reversible.
 */
export async function closeDuplicates({ windowId, scope = "all", keep = "active", apply = true } = {}) {
  const groups = await scanDuplicates({ windowId, scope, keep });
  const toClose = groups.flatMap((g) => g.removable);
  if (!apply || !toClose.length) return { groups, closed: 0, closedTabs: [], undo: null };

  const closedTabs = [];
  for (const id of toClose) {
    try {
      closedTabs.push(await chrome.tabs.get(id));
    } catch {
      /* already gone */
    }
  }
  const { closed: closedIds, failed } = await removeTabsResilient(closedTabs.map((t) => t.id));
  const removed = closedTabs.filter((t) => closedIds.includes(t.id));
  return {
    groups,
    closed: removed.length,
    closedTabs: removed,
    failed,
    undo: removed.map((t) => ({ url: t.url, windowId: t.windowId, index: t.index, pinned: t.pinned })),
  };
}

export async function restoreClosed(closedTabs) {
  const restored = [];
  for (const t of closedTabs) {
    try {
      const tab = await chrome.tabs.create({ url: t.url, windowId: t.windowId, active: false, index: t.index, pinned: t.pinned });
      restored.push(tab);
    } catch {
      const tab = await chrome.tabs.create({ url: t.url, active: false, pinned: t.pinned });
      restored.push(tab);
    }
  }
  await suppressFor(2500);
  return restored;
}

/**
 * Called by the service worker when a tab finishes loading.
 * Returns a verdict the UI turns into a prompt; nothing is closed here. Opening
 * a second copy of a page is a legitimate move (a fresh login form, a scratch
 * comparison), so whether the duplicate goes away stays the user's call.
 */
export async function inspectNewTab(tab) {
  const settings = store.get("settings") || {};
  if (settings.duplicateWarning === false) return null;
  if (!isTrackable(tab.url)) return null;
  if (await isSuppressed()) return null;

  const key = urlKey(tab.url);
  const all = await chrome.tabs.query({});
  const same = all.filter((t) => t.id !== tab.id && urlKey(t.url) === key);
  if (!same.length) return null;

  const existing = same.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  const storedWindows = store.get("windows") || {};
  const wins = await getAllWindows({ populate: false });
  const host = wins.find((w) => w.id === existing.windowId);
  return {
    key,
    newTab: tab,
    existing,
    location: host ? windowLabel(host, storedWindows[host.id], windowOrdinals(wins).get(host.id)) : "另一个窗口",
  };
}

export async function switchToTab(tabId, windowId) {
  if (windowId != null) await chrome.windows.update(windowId, { focused: true }).catch(() => {});
  await chrome.tabs.update(tabId, { active: true });
  return { ok: true };
}

/**
 * The prompt's "close it" choice: dismiss the freshly opened copy, then focus the
 * tab that was already there. Close first — focusing first would leave the
 * survivor's window behind whatever Chrome promotes when a tab disappears.
 */
export async function closeAndSwitch(newTabId, existingTabId, existingWindowId) {
  await removeTabsResilient([newTabId]);
  return switchToTab(existingTabId, existingWindowId);
}
