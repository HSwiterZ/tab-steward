import { getCollection } from "./collections.js";

const BAR_ID = "1"; // Chrome's 书签栏 node id

export async function getTree() {
  const [root] = await chrome.bookmarks.getTree();
  return root;
}

function walk(node, path = [], out = []) {
  const isFolder = !node.url;
  const current = isFolder ? [...path, node.title].filter(Boolean) : path;
  if (isFolder && path.length >= 0 && node.id !== "0") {
    out.push({ id: node.id, title: node.title || "（未命名文件夹）", path: current.join(" / "), depth: current.length, parentId: node.parentId });
  }
  for (const child of node.children || []) walk(child, current, out);
  return out;
}

/** Flat list of every bookmark folder, with its display path. */
export async function listFolders() {
  const root = await getTree();
  const folders = [];
  for (const top of root.children || []) {
    for (const f of walk(top, [], [])) folders.push(f);
  }
  return folders;
}

export async function listBookmarks() {
  const root = await getTree();
  const out = [];
  const rec = (node, path) => {
    if (node.url) out.push({ id: node.id, title: node.title, url: node.url, parentId: node.parentId, dateAdded: node.dateAdded, path });
    for (const c of node.children || []) rec(c, node.url ? path : [...path, node.title].filter(Boolean));
  };
  rec(root, []);
  return out;
}

/**
 * Resolve "工作 / 前端 / 参考" into a folder id, creating any missing levels.
 * Accepts an array of names or a "/"-separated string.
 */
export async function ensureFolder(pathInput, { parentId = BAR_ID } = {}) {
  const parts = (Array.isArray(pathInput) ? pathInput : String(pathInput || "").split("/"))
    .map((s) => String(s).trim())
    .filter(Boolean);
  if (!parts.length) return parentId;

  let currentId = parentId;
  for (const part of parts) {
    const children = await chrome.bookmarks.getChildren(currentId);
    const existing = children.find((c) => !c.url && c.title === part);
    if (existing) {
      currentId = existing.id;
    } else {
      const created = await chrome.bookmarks.create({ parentId: currentId, title: part });
      currentId = created.id;
    }
  }
  return currentId;
}

export async function createFolder(name, parentId = BAR_ID) {
  return chrome.bookmarks.create({ parentId, title: name });
}

/** Save one or many tabs under a folder path, optionally in a new subfolder. */
export async function saveTabsToBookmarks(tabs, { folderPath, subfolder } = {}) {
  const parentId = await ensureFolder(folderPath || "标签管理器");
  const targetId = subfolder ? await ensureFolder(subfolder, { parentId }) : parentId;
  const created = [];
  const skipped = [];
  const existing = await chrome.bookmarks.getChildren(targetId);
  const existingUrls = new Set(existing.filter((c) => c.url).map((c) => c.url));
  for (const tab of tabs) {
    if (!tab.url || /^(chrome|edge|about|chrome-extension|devtools):/.test(tab.url)) {
      skipped.push({ tab, reason: "浏览器内部页无法加入书签" });
      continue;
    }
    if (existingUrls.has(tab.url)) {
      skipped.push({ tab, reason: "该网址已存在于此文件夹" });
      continue;
    }
    created.push(await chrome.bookmarks.create({ parentId: targetId, title: tab.title || tab.url, url: tab.url }));
    existingUrls.add(tab.url);
  }
  return { folderId: targetId, created: created.length, skipped, nodes: created };
}

/** Archive a whole collection into bookmarks as its own subfolder. */
export async function archiveCollectionToBookmarks(collectionId, { folderPath = "标签管理器", subfolder } = {}) {
  const col = getCollection(collectionId);
  if (!col) throw new Error("收藏区不存在");
  const items = (col.items || []).filter((i) => i.url && !/^(chrome|edge|about|chrome-extension):/.test(i.url));
  if (!items.length) return { created: 0, folderId: null };
  return saveTabsToBookmarks(items.map((i) => ({ url: i.url, title: i.title })), {
    folderPath,
    subfolder: subfolder ?? col.name,
  });
}

export async function searchBookmarks(query) {
  if (!query) return [];
  return chrome.bookmarks.search(query).catch(() => []);
}

export async function removeBookmark(id) {
  const node = (await chrome.bookmarks.get(id))[0];
  if (!node) return { ok: false };
  if (!node.url) await chrome.bookmarks.removeTree(id);
  else await chrome.bookmarks.remove(id);
  return { ok: true, node };
}

export async function bookmarkExists(url) {
  const hits = await chrome.bookmarks.search(url).catch(() => []);
  return hits.some((h) => h.url === url);
}

/** Folders that already look like ours, so the picker can offer them first. */
export async function suggestedFolders() {
  const folders = await listFolders();
  const ours = folders.filter((f) => f.path.includes("标签管理器"));
  return [...ours, ...folders.filter((f) => !ours.includes(f))];
}
