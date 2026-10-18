import { store } from "./storage.js";
import { LIMITS } from "./defaults.js";
import { uid, now as ts, hostname } from "./utils.js";
import { windowLabel, windowOrdinals, removeTabsResilient } from "./actions.js";
import { pushTrash } from "./trash.js";

/**
 * A snapshot records window names and geometry, tab order, pinned state and
 * Chrome tab groups so a workspace can be rebuilt exactly.
 */
export async function captureSnapshot({ scope = "current", name } = {}) {
  const windows = await chrome.windows.getAll({ populate: true });
  const stored = store.get("windows") || {};
  const ordinals = windowOrdinals(windows);
  const targets = scope === "all" ? windows.filter((w) => w.type === "normal") : windows.filter((w) => w.focused);
  if (!targets.length) throw new Error("没有可保存的窗口");

  const groups = await chrome.tabGroups.query({}).catch(() => []);
  const groupById = new Map(groups.map((g) => [g.id, g]));

  const payload = targets.map((w) => {
    const tabs = [...(w.tabs || [])].sort((a, b) => a.index - b.index);
    return {
      windowId: w.id,
      name: windowLabel(w, stored[w.id], ordinals.get(w.id)),
      type: w.type,
      state: w.state,
      left: w.left,
      top: w.top,
      width: w.width,
      height: w.height,
      focused: !!w.focused,
      activeIndex: Math.max(0, tabs.findIndex((t) => t.active)),
      tabs: tabs.map((t, i) => ({
        index: i,
        url: t.url,
        title: t.title || t.url,
        pinned: !!t.pinned,
        active: !!t.active,
        groupId: t.groupId > -1 ? t.groupId : null,
        groupTitle: t.groupId > -1 ? groupById.get(t.groupId)?.title || "" : "",
        groupColor: t.groupId > -1 ? groupById.get(t.groupId)?.color || "grey" : null,
        groupCollapsed: t.groupId > -1 ? !!groupById.get(t.groupId)?.collapsed : false,
      })),
    };
  });

  const snapshot = {
    id: uid("snap"),
    name: name || defaultName(payload),
    createdAt: ts(),
    scope,
    windowCount: payload.length,
    tabCount: payload.reduce((s, w) => s + w.tabs.length, 0),
    hosts: [...new Set(payload.flatMap((w) => w.tabs.map((t) => hostname(t.url)).filter(Boolean)))].slice(0, 40),
    windows: payload,
  };

  let list = [snapshot, ...(store.get("snapshots") || [])];
  if (list.length > LIMITS.snapshots) list = list.slice(0, LIMITS.snapshots);
  await store.set("snapshots", list);
  return snapshot;
}

function defaultName(payload) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const first = payload[0]?.name;
  const tabs = payload.reduce((s, w) => s + w.tabs.length, 0);
  return `${first || "工作区"} · ${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} · ${tabs} 标签`;
}

export function listSnapshots() {
  return (store.get("snapshots") || []).slice().sort((a, b) => b.createdAt - a.createdAt);
}

export function getSnapshot(id) {
  return listSnapshots().find((s) => s.id === id) || null;
}

export async function renameSnapshot(id, name) {
  await store.set("snapshots", (store.get("snapshots") || []).map((s) => (s.id === id ? { ...s, name } : s)));
  return getSnapshot(id);
}

export async function deleteSnapshot(id) {
  const snap = getSnapshot(id);
  if (!snap) return null;
  await pushTrash("snapshot", JSON.parse(JSON.stringify(snap)), snap.name);  await store.set("snapshots", (store.get("snapshots") || []).filter((s) => s.id !== id));
  return snap;
}

/**
 * Rebuild a snapshot.
 *  mode "new"     — open every window fresh, leave the current workspace alone
 *  mode "replace" — reuse existing normal windows where possible, then close leftovers
 *  closeExisting — close all normal windows before restoring
 */
export async function restoreSnapshot(id, { mode = "new", closeExisting = false, focus = true } = {}) {
  const snap = getSnapshot(id);
  if (!snap) throw new Error("快照不存在");

  const report = { windows: 0, tabs: 0, groups: 0, closed: 0 };

  if (closeExisting) {
    const existing = await chrome.windows.getAll({ windowTypes: ["normal"] });
    for (const w of existing) {
      await chrome.windows.remove(w.id).catch(() => {});
      report.closed++;
    }
  }

  const reusable = mode === "replace" ? (await chrome.windows.getAll({ windowTypes: ["normal"] })).sort((a, b) => a.id - b.id) : [];

  for (let wi = 0; wi < snap.windows.length; wi++) {
    const spec = snap.windows[wi];
    const urls = spec.tabs.length ? spec.tabs.map((t) => t.url) : ["chrome://newtab/"];
    let win = reusable[wi];

    if (win) {
      const current = await chrome.tabs.query({ windowId: win.id });
      await chrome.tabs.create({ url: urls, windowId: win.id, active: false });
      if (current.length) await removeTabsResilient(current.map((t) => t.id));
      report.closed += 0;
    } else {
      win = await chrome.windows.create({
        url: urls,
        left: spec.left,
        top: spec.top,
        width: spec.width,
        height: spec.height,
        state: spec.state === "minimized" ? "minimized" : "normal",
        focused: false,
      });
    }

    const created = await chrome.tabs.query({ windowId: win.id });
    const byUrl = new Map();
    for (const t of created) {
      if (!byUrl.has(t.url)) byUrl.set(t.url, []);
      byUrl.get(t.url).push(t);
    }

    const ordered = [];
    for (const specTab of spec.tabs) {
      const pool = byUrl.get(specTab.url) || [];
      const tab = pool.shift();
      if (tab) ordered.push({ tab, spec: specTab });
    }

    // restore order
    for (let i = 0; i < ordered.length; i++) {
      await chrome.tabs.move(ordered[i].tab.id, { windowId: win.id, index: i }).catch(() => {});
    }
    // restore pinned
    for (const { tab, spec: specTab } of ordered) {
      if (specTab.pinned && !tab.pinned) await chrome.tabs.update(tab.id, { pinned: true }).catch(() => {});
    }
    // restore tab groups
    const groupKeyToId = new Map();
    for (const { tab, spec: specTab } of ordered) {
      if (!specTab.groupTitle && specTab.groupId == null) continue;
      const key = `${specTab.groupTitle || "group"}|${specTab.groupColor || "grey"}`;
      let groupId = groupKeyToId.get(key);
      try {
        groupId = await chrome.tabs.group({ tabIds: tab.id, groupId: groupId ?? undefined });
        groupKeyToId.set(key, groupId);
        report.groups++;
      } catch {
        continue;
      }
    }
    for (const [key, groupId] of groupKeyToId) {
      const [title, color] = key.split("|");
      const sample = snap.windows[wi].tabs.find((t) => `${t.groupTitle || "group"}|${t.groupColor || "grey"}` === key);
      await chrome.tabGroups
        .update(groupId, { title: title === "group" ? "" : title, color: color || "grey", collapsed: !!sample?.groupCollapsed })
        .catch(() => {});
    }

    // window name + active tab
    if (spec.name && !spec.name.startsWith("窗口 ")) {
      const windows = { ...(store.get("windows") || {}) };
      windows[win.id] = { ...(windows[win.id] || {}), name: spec.name };
      await store.set("windows", windows);
    }
    const activeTab = ordered[spec.activeIndex]?.tab;
    if (activeTab) await chrome.tabs.update(activeTab.id, { active: true }).catch(() => {});

    report.windows++;
    report.tabs += ordered.length;
  }

  if (focus) {
    const all = await chrome.windows.getAll({});
    const last = all[all.length - 1];
    if (last) await chrome.windows.update(last.id, { focused: true, drawAttention: true }).catch(() => {});
  }

  await store.set(
    "snapshots",
    (store.get("snapshots") || []).map((s) => (s.id === id ? { ...s, lastRestoredAt: ts(), restoreCount: (s.restoreCount || 0) + 1 } : s))
  );
  return report;
}

/** Light-weight preview data for the snapshot dialog. */
export function previewSnapshot(id) {
  const snap = getSnapshot(id);
  if (!snap) return null;
  return {
    name: snap.name,
    createdAt: snap.createdAt,
    windows: snap.windows.map((w) => ({
      name: w.name,
      tabCount: w.tabs.length,
      groups: [...new Set(w.tabs.filter((t) => t.groupTitle).map((t) => t.groupTitle))],
      tabs: w.tabs.slice(0, 60).map((t) => ({ title: t.title, url: t.url, pinned: t.pinned, groupTitle: t.groupTitle })),
    })),
  };
}
