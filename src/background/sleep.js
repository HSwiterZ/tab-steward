import { store } from "../core/storage.js";
import { urlKey, hostname } from "../core/utils.js";
import { isOn } from "../core/modules.js";
import { idleMsFor } from "../core/stats.js";
import { canSleep, skipReason } from "../core/actions.js";
import { ALARM_AUTOSLEEP } from "../core/reminders.js";

/**
 * Work out which tabs the auto-sleep policy would discard right now.
 * Active, pinned, audible, already-discarded and protected-site tabs are always
 * spared; each rule can also be turned off individually in settings.
 */
export async function planAutoSleep({ reference = Date.now(), idleMinutes } = {}) {
  const settings = store.get("settings") || {};
  const cfg = settings.autoSleep || {};
  if (!isOn(settings, "sleep")) return { enabled: false, candidates: [], skipped: [], thresholdMs: 0 };
  if (cfg.enabled === false && idleMinutes == null) return { enabled: false, candidates: [], skipped: [], thresholdMs: 0 };

  const minutes = Math.max(1, idleMinutes ?? cfg.idleMinutes ?? 120);
  const thresholdMs = minutes * 60_000;
  const stats = store.get("stats") || {};
  const sites = store.get("sites") || {};
  const tabs = await chrome.tabs.query({});

  const candidates = [];
  const skipped = [];

  for (const tab of tabs) {
    const stat = stats[urlKey(tab.url)];
    const idleMs = idleMsFor(tab, stat, reference);
    const reason = evaluate(tab, cfg, sites, idleMs, thresholdMs);
    if (reason === null) {
      if (canSleep(tab)) candidates.push({ tab, idleMs });
      else skipped.push({ tab, idleMs, reason: skipReason(tab) });
    } else {
      skipped.push({ tab, idleMs, reason });
    }
  }

  candidates.sort((a, b) => b.idleMs - a.idleMs);
  return { enabled: true, candidates, skipped, thresholdMs, idleMinutes: minutes };
}

function evaluate(tab, cfg, sites, idleMs, thresholdMs) {
  if (cfg.skipActive !== false && tab.active) return "正在使用";
  if (cfg.skipPinned !== false && tab.pinned) return "已固定";
  if (cfg.skipAudible !== false && tab.audible) return "正在播放声音";
  if (cfg.skipAlreadyDiscarded !== false && tab.discarded) return "已休眠";
  if (cfg.skipProtected !== false && sites[hostname(tab.url)]?.protected) return "受保护站点";
  if (/^(chrome|edge|about|devtools|chrome-extension):/.test(tab.url || "")) return "浏览器内部页";
  if (idleMs < thresholdMs) return `闲置 ${Math.round(idleMs / 60000)} 分钟，未达阈值`;
  return null;
}

export async function runAutoSleep({ notify = true, reference = Date.now(), idleMinutes } = {}) {
  const plan = await planAutoSleep({ reference, idleMinutes });
  if (!plan.enabled || !plan.candidates.length) return { slept: 0, candidates: 0 };

  const ids = plan.candidates.map((c) => c.tab.id);
  const slept = [];
  for (const id of ids) {
    try {
      await chrome.tabs.discard(id);
      slept.push(id);
    } catch {
      /* Chrome refuses some tabs (e.g. playing audio); nothing to do */
    }
  }

  if (slept.length) {
    const stats = { ...(store.get("stats") || {}) };
    for (const c of plan.candidates) {
      if (!slept.includes(c.tab.id)) continue;
      const k = urlKey(c.tab.url);
      if (stats[k]) stats[k] = { ...stats[k], lastSleepAt: reference, discardCount: (stats[k].discardCount || 0) + 1, autoSlept: true };
    }
    await store.set("stats", stats);

    const settings = store.get("settings") || {};
    if (notify && settings.autoSleep?.notify !== false && chrome.notifications?.create) {
      const sample = plan.candidates.filter((c) => slept.includes(c.tab.id)).slice(0, 3);
      await chrome.notifications
        .create(`auto-sleep-${reference}`, {
          type: "basic",
          iconUrl: chrome.runtime.getURL("assets/icon128.png"),
          title: `已自动休眠 ${slept.length} 个标签`,
          message: sample.map((c) => c.tab.title || c.tab.url).join("\n"),
        })
        .catch(() => null);
    }

    chrome.runtime.sendMessage({ type: "sleep:auto", payload: { count: slept.length, ids: slept } }).catch(() => {});
  }

  return { slept: slept.length, candidates: ids.length };
}

/** Re-arm the periodic alarm whenever the policy changes. */
export async function syncSleepAlarm() {
  const settings = store.get("settings") || {};
  const cfg = settings.autoSleep || {};
  if (!chrome.alarms) return;
  if (!isOn(settings, "sleep") || cfg.enabled === false) {
    await chrome.alarms.clear(ALARM_AUTOSLEEP).catch(() => {});
    return;
  }
  const every = Math.max(1, cfg.checkEveryMinutes ?? 10);
  const existing = await chrome.alarms.get(ALARM_AUTOSLEEP);
  if (existing && existing.periodInMinutes === every) return;
  chrome.alarms.create(ALARM_AUTOSLEEP, { periodInMinutes: every, delayInMinutes: Math.min(2, every) });
}

/** Manual "sleep everything idle now" for the dashboard buttons. */
export async function sleepIdleNow({ idleMinutes = 60 } = {}) {
  return runAutoSleep({ notify: false, idleMinutes });
}

/** Everything the settings page needs to explain the current policy. */
export async function describePolicy() {
  const plan = await planAutoSleep();
  const settings = store.get("settings") || {};
  return {
    enabled: isOn(settings, "sleep") && settings.autoSleep?.enabled !== false,
    idleMinutes: settings.autoSleep?.idleMinutes ?? 120,
    checkEveryMinutes: settings.autoSleep?.checkEveryMinutes ?? 10,
    wouldSleep: plan.candidates.length,
    wouldSkip: plan.skipped.length,
    nextRunInMinutes: settings.autoSleep?.checkEveryMinutes ?? 10,
  };
}
