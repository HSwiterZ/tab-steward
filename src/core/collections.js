import { store } from "./storage.js";
import { LIMITS } from "./defaults.js";
import { uid, now as ts, urlKey, moveItem, hostname } from "./utils.js";
import { removeTabsResilient } from "./actions.js";
import { pushTrash } from "./trash.js";

export const STASH_ID = "stash";

const clone = (v) => JSON.parse(JSON.stringify(v));

function collections() {
  return store.get("collections") || [];
}

export function listCollections() {
  return collections();
}

export function getCollection(id) {
  return collections().find((c) => c.id === id) || null;
}

export function stashCollection() {
  return getCollection(STASH_ID);
}

export function customCollections() {
  return collections().filter((c) => c.id !== STASH_ID);
}

export async function createCollection(name = "新收藏区") {
  const col = { id: uid("col"), name, kind: "custom", collapsed: false, createdAt: ts(), items: [] };
  await store.set("collections", [...collections(), col]);
  return col;
}

export async function renameCollection(id, name) {
  const next = collections().map((c) => (c.id === id ? { ...c, name } : c));
  await store.set("collections", next);
  return getCollection(id);
}

export async function setCollectionCollapsed(id, collapsed) {
  await store.set("collections", collections().map((c) => (c.id === id ? { ...c, collapsed: !!collapsed } : c)));
}

export async function deleteCollection(id) {
  if (id === STASH_ID) throw new Error("暂存区不能删除");
  const col = getCollection(id);
  if (!col) return null;
  await pushTrash("collection", clone(col), col.name);
  await store.set("collections", collections().filter((c) => c.id !== id));
  return col;
}

export async function reorderCollections(fromId, toIndex) {
  const list = collections();
  const from = list.findIndex((c) => c.id === fromId);
  if (from < 0) return list;
  const next = moveItem(list, from, toIndex);
  /* the built-in stash is always kept first */
  const stash = next.find((c) => c.id === STASH_ID);
  const rest = next.filter((c) => c.id !== STASH_ID);
  const ordered = stash ? [stash, ...rest] : rest;
  await store.set("collections", ordered);
  return ordered;
}

export function makeItem(tab, extra = {}) {
  return {
    id: uid("it"),
    title: tab.title || tab.url || "未命名",
    url: tab.url || "",
    favIconUrl: tab.favIconUrl || "",
    pinned: !!tab.pinned,
    addedAt: ts(),
    note: "",
    source: "manual",
    ...extra,
  };
}

export async function addItems(collectionId, items) {
  const list = collections().map((c) => {
    if (c.id !== collectionId) return c;
    const existing = new Set((c.items || []).map((i) => i.id));
    const fresh = items.filter((i) => !existing.has(i.id));
    return { ...c, items: [...(c.items || []), ...fresh] };
  });
  await store.set("collections", list);
  return getCollection(collectionId);
}

/**
 * Stash or favourite tabs.
 * `close: true` is 保存并关闭, `close: false` is 保存但保留标签.
 */
export async function stashTabs(tabs, { collectionId = STASH_ID, close = false, source = "manual" } = {}) {
  const items = tabs.map((t) => makeItem(t, { source, windowId: t.windowId, tabId: close ? undefined : t.id }));
  const col = await addItems(collectionId, items);
  let closed = 0;
  let failed = [];
  if (close) {
    const ids = tabs.filter((t) => !t.pinned).map((t) => t.id);
    if (ids.length) {
      const r = await removeTabsResilient(ids);
      closed = r.closed.length;
      failed = r.failed;
    }
  }
  return { items, collection: col, closed, failed };
}

export async function removeItem(collectionId, itemId) {
  const col = getCollection(collectionId);
  const item = col?.items.find((i) => i.id === itemId);
  if (!item) return null;
  await pushTrash("item", { collectionId, item: clone(item) }, item.title);
  await store.set(
    "collections",
    collections().map((c) => (c.id === collectionId ? { ...c, items: c.items.filter((i) => i.id !== itemId) } : c))
  );
  return item;
}

export async function updateItem(collectionId, itemId, patch) {
  await store.set(
    "collections",
    collections().map((c) => (c.id === collectionId ? { ...c, items: c.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) } : c))
  );
  return getCollection(collectionId)?.items.find((i) => i.id === itemId) || null;
}

export async function moveItemBetween(itemId, fromCollectionId, toCollectionId, toIndex) {
  const list = clone(collections());
  const from = list.find((c) => c.id === fromCollectionId);
  const to = list.find((c) => c.id === toCollectionId);
  if (!from || !to) return null;
  const idx = from.items.findIndex((i) => i.id === itemId);
  if (idx < 0) return null;
  const [item] = from.items.splice(idx, 1);
  const at = toIndex == null || toIndex < 0 ? to.items.length : Math.min(toIndex, to.items.length);
  to.items.splice(at, 0, item);
  await store.set("collections", list);
  return item;
}

export async function reorderItems(collectionId, itemId, toIndex) {
  const list = clone(collections());
  const col = list.find((c) => c.id === collectionId);
  if (!col) return;
  const from = col.items.findIndex((i) => i.id === itemId);
  if (from < 0) return;
  col.items = moveItem(col.items, from, toIndex);
  await store.set("collections", list);
}

export async function openItem(item, { remove = false, collectionId, windowId, active = true } = {}) {
  const tab = await chrome.tabs.create({ url: item.url, windowId, active });
  if (remove && collectionId) await removeItem(collectionId, item.id);
  return tab;
}

export async function openCollection(collectionId, { newWindow = true, remove = false } = {}) {
  const col = getCollection(collectionId);
  if (!col || !col.items.length) return { opened: 0 };
  const urls = col.items.map((i) => i.url).filter(Boolean);
  let opened = 0;
  if (newWindow) {
    const win = await chrome.windows.create({ url: urls.slice(0, 10), focused: true });
    for (const u of urls.slice(10)) await chrome.tabs.create({ url: u, windowId: win.id, active: false });
    opened = urls.length;
    if (remove) await store.set("collections", collections().map((c) => (c.id === collectionId ? { ...c, items: [] } : c)));
    return { opened, windowId: win.id };
  }
  const current = await chrome.windows.getLastFocused({});
  for (const u of urls) {
    await chrome.tabs.create({ url: u, windowId: current?.id, active: false });
    opened++;
  }
  if (remove) await store.set("collections", collections().map((c) => (c.id === collectionId ? { ...c, items: [] } : c)));
  return { opened };
}

/** Which collections already hold this URL — drives the "already stashed" badge. */
export function findItemByUrl(url) {
  const key = urlKey(url);
  const hits = [];
  for (const col of collections()) {
    for (const item of col.items || []) {
      if (urlKey(item.url) === key) hits.push({ collection: col, item });
    }
  }
  return hits;
}

export function isStashed(url) {
  return findItemByUrl(url).length > 0;
}

export function collectionSummary() {
  return collections().map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    count: (c.items || []).length,
    hosts: [...new Set((c.items || []).map((i) => hostname(i.url)).filter(Boolean))],
  }));
}

export function allItems() {
  const out = [];
  for (const col of collections()) for (const item of col.items || []) out.push({ ...item, collectionId: col.id, collectionName: col.name });
  return out;
}

/** Enforce the item cap so a long-lived store can't grow unbounded. */
export async function enforceLimits() {
  const list = collections();
  let changed = false;
  const next = list.map((c) => {
    if ((c.items || []).length <= LIMITS.trash * 10) return c;
    changed = true;
    return { ...c, items: c.items.slice(0, LIMITS.trash * 10) };
  });
  if (changed) await store.set("collections", next);
  return next;
}
