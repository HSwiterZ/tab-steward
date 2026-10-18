import { store } from "./storage.js";
import { LIMITS, TRASH_KINDS } from "./defaults.js";
import { uid, now as ts } from "./utils.js";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function listTrash() {
  return store.get("trash") || [];
}

export async function pushTrash(kind, payload, label = "") {
  const entry = { id: uid("tr"), kind, label, payload, deletedAt: ts() };
  if (!TRASH_KINDS[kind]) throw new Error(`未知回收站类型：${kind}`);
  let list = [entry, ...listTrash()];
  if (list.length > LIMITS.trash) list = list.slice(0, LIMITS.trash);
  await store.set("trash", list);
  return entry;
}

export async function restoreEntry(id) {
  const entry = listTrash().find((e) => e.id === id);
  if (!entry) return { ok: false, error: "条目不存在" };

  switch (entry.kind) {
    case "collection": {
      const collections = store.get("collections") || [];
      if (collections.some((c) => c.id === entry.payload.id)) return { ok: false, error: "同名收藏区已存在" };
      await store.set("collections", [...collections, entry.payload]);
      break;
    }
    case "item": {
      const { collectionId, item } = entry.payload;
      const collections = store.get("collections") || [];
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return { ok: false, error: "所属收藏区已不存在" };
      await store.set(
        "collections",
        collections.map((c) => (c.id === collectionId ? { ...c, items: [...c.items, item] } : c))
      );
      break;
    }
    case "snapshot": {
      const snapshots = store.get("snapshots") || [];
      await store.set("snapshots", [entry.payload, ...snapshots.filter((s) => s.id !== entry.payload.id)]);
      break;
    }
    case "site": {
      const sites = { ...(store.get("sites") || {}) };
      sites[entry.payload.host] = entry.payload;
      await store.set("sites", sites);
      break;
    }
    default:
      return { ok: false, error: `不支持恢复：${entry.kind}` };
  }

  await store.set("trash", listTrash().filter((e) => e.id !== id));
  return { ok: true, entry };
}

export async function purgeEntry(id) {
  await store.set("trash", listTrash().filter((e) => e.id !== id));
  return { ok: true };
}

export async function clearTrash() {
  const count = listTrash().length;
  await store.set("trash", []);
  return { cleared: count };
}

/** Drop entries older than the retention window; called on startup and daily. */
export async function autoPurge(reference = Date.now()) {
  const list = listTrash();
  const kept = list.filter((e) => reference - e.deletedAt < RETENTION_MS);
  if (kept.length !== list.length) await store.set("trash", kept);
  return { removed: list.length - kept.length };
}

export function trashStats() {
  const list = listTrash();
  const byKind = {};
  for (const e of list) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  const oldest = list.length ? Math.min(...list.map((e) => e.deletedAt)) : 0;
  return { total: list.length, byKind, oldest, expiresAt: oldest ? oldest + RETENTION_MS : 0 };
}
