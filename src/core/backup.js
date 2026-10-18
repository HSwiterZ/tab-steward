import { store } from "./storage.js";
import { DB_VERSION } from "./defaults.js";
import { now as ts } from "./utils.js";
import { syncAlarms } from "./reminders.js";

const EXPORTABLE = ["settings", "collections", "sites", "stats", "reminders", "snapshots", "trash", "windows", "searches", "lockedCards"];

export function buildBackup({ includeStats = true } = {}) {
  const data = {
    app: "tab-steward",
    format: 1,
    dbVersion: DB_VERSION,
    exportedAt: ts(),
  };
  for (const slice of EXPORTABLE) {
    if (slice === "stats" && !includeStats) continue;
    data[slice] = store.get(slice);
  }
  return data;
}

export function backupFilename() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `tab-steward-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

/**
 * Validate an imported document without touching storage.
 * Returns a diff summary the UI shows before the user picks merge or overwrite.
 */
export function validateBackup(data) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== "object") return { ok: false, errors: ["文件内容不是 JSON 对象"], warnings, summary: null };
  if (data.app && data.app !== "tab-steward") warnings.push(`来源标记为 "${data.app}"，不是本扩展导出的文件`);
  if (data.format && Number(data.format) > 1) errors.push(`备份格式版本 ${data.format} 高于当前支持的 1`);
  if (data.dbVersion && Number(data.dbVersion) > DB_VERSION) warnings.push(`数据版本 ${data.dbVersion} 高于当前 ${DB_VERSION}，部分字段可能被忽略`);

  const found = EXPORTABLE.filter((k) => k in data);
  if (!found.length) errors.push("没有找到任何可导入的数据段");

  const summary = { sections: [], totals: {} };
  const expect = (name, value, check) => {
    if (!(name in data)) return;
    if (!check(value)) {
      errors.push(`数据段 ${name} 的类型不正确`);
      return;
    }
  };

  expect("settings", data.settings, (v) => v && typeof v === "object" && !Array.isArray(v));
  expect("collections", data.collections, Array.isArray);
  expect("sites", data.sites, (v) => v && typeof v === "object");
  expect("stats", data.stats, (v) => v && typeof v === "object");
  expect("reminders", data.reminders, Array.isArray);
  expect("snapshots", data.snapshots, Array.isArray);
  expect("trash", data.trash, Array.isArray);
  expect("windows", data.windows, (v) => v && typeof v === "object");
  expect("searches", data.searches, (v) => v && typeof v === "object");
  expect("lockedCards", data.lockedCards, Array.isArray);

  if (Array.isArray(data.collections)) {
    for (const col of data.collections) {
      if (!col || typeof col.id !== "string") {
        errors.push("收藏区缺少 id 字段");
        break;
      }
      if (Array.isArray(col.items)) {
        for (const item of col.items) {
          if (!item || typeof item.url !== "string") {
            warnings.push(`收藏区「${col.name}」中存在缺少 url 的条目，将被跳过`);
            break;
          }
        }
      }
    }
  }

  if (Array.isArray(data.snapshots)) {
    for (const snap of data.snapshots) {
      if (!snap || !Array.isArray(snap.windows)) {
        warnings.push("存在结构不完整的工作区快照，恢复时可能失败");
        break;
      }
    }
  }

  const countOf = (k, fallback = 0) => (Array.isArray(data[k]) ? data[k].length : data[k] && typeof data[k] === "object" ? Object.keys(data[k]).length : fallback);
  const current = {
    collections: (store.get("collections") || []).length,
    items: (store.get("collections") || []).reduce((s, c) => s + (c.items || []).length, 0),
    snapshots: (store.get("snapshots") || []).length,
    reminders: (store.get("reminders") || []).length,
    stats: Object.keys(store.get("stats") || {}).length,
    sites: Object.keys(store.get("sites") || {}).length,
  };
  const incoming = {
    collections: Array.isArray(data.collections) ? data.collections.length : 0,
    items: Array.isArray(data.collections) ? data.collections.reduce((s, c) => s + (c.items || []).length, 0) : 0,
    snapshots: countOf("snapshots"),
    reminders: countOf("reminders"),
    stats: countOf("stats"),
    sites: countOf("sites"),
  };
  for (const key of Object.keys(incoming)) {
    summary.sections.push({ key, label: SECTION_LABELS[key] || key, current: current[key] ?? 0, incoming: incoming[key] });
    summary.totals[key] = incoming[key];
  }
  summary.exportedAt = data.exportedAt || 0;

  return { ok: errors.length === 0, errors, warnings, summary };
}

const SECTION_LABELS = {
  collections: "收藏区",
  items: "收藏条目",
  snapshots: "工作区快照",
  reminders: "提醒",
  stats: "使用统计",
  sites: "站点设置",
};

/**
 * Apply a validated backup.
 * mode "merge" keeps existing records and adds anything new;
 * mode "overwrite" replaces each present section outright.
 */
export async function applyBackup(data, { mode = "merge", includeStats = true } = {}) {
  const report = { mode, applied: [], skipped: [], errors: [] };
  for (const slice of EXPORTABLE) {
    if (!(slice in data)) {
      report.skipped.push(slice);
      continue;
    }
    if (slice === "stats" && !includeStats) {
      report.skipped.push(slice);
      continue;
    }
    if (slice === "meta") continue;
    try {
      if (mode === "overwrite") {
        await store.set(slice, data[slice]);
      } else {
        await store.importAll({ [slice]: data[slice] }, { mode: "merge" });
      }
      report.applied.push(slice);
    } catch (err) {
      report.errors.push(`${slice}: ${err.message}`);
    }
  }
  // An imported reminder is only useful with an alarm behind it, and neither the
  // service worker's startup nor its install pass runs again on import.
  if (report.applied.includes("reminders")) await syncAlarms();
  return report;
}

export function estimateSize(data) {
  return new Blob([JSON.stringify(data)]).size;
}
