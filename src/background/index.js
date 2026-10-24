import { store } from "../core/storage.js";
import { urlKey, hostname } from "../core/utils.js";
import { isOn, moduleById } from "../core/modules.js";
import { installTracker, primeTracker, flush, housekeeping, analyticsSummary } from "./tracker.js";
import { runAutoSleep, planAutoSleep, syncSleepAlarm, sleepIdleNow, describePolicy } from "./sleep.js";
import { capturePreview, getPreview, hasCapturePermission } from "./screenshots.js";
import {
  ALARM_AUTOSLEEP,
  ALARM_FLUSH,
  ALARM_HOUSEKEEP,
  ALARM_PREFIX,
  createReminder,
  ensureHousekeepingAlarms,
  fireReminder,
  refreshBadge,
  syncAlarms,
  snoozeReminder,
  gotoReminder,
  listReminders,
} from "../core/reminders.js";
import { inspectNewTab, isSuppressed, scanDuplicates, closeDuplicates, switchToTab, closeAndSwitch } from "../core/dupes.js";
import { protectSite, canSleep, skipReason, windowLabel, windowOrdinals } from "../core/actions.js";
import { STASH_ID, stashTabs } from "../core/collections.js";
import { arrangeBySite, arrangeAllWindows, applyCollectionsAsGroups, buildSuggestions } from "../core/organize.js";
import { requestSuggestions as llmRequest, applyPlan as llmApply } from "../core/llm.js";

const DUPE_NID_PREFIX = "dupe-";
const REMINDER_NID_PREFIX = "reminder-";
const checkedDupeKeys = new Set();
/** Duplicate prompts are informational, not a pending task: let them go. */
const DUPE_NOTIFICATION_TTL_MS = 10_000;

/* ====================================================================== *
 * startup
 * ====================================================================== */

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await store.ready;
  if (reason === "install") {
    // Defaults already carry the shipped configuration: duplicate warning and
    // 120-minute auto-sleep on; LLM, newtab dashboard and both
    // experimental flags off. Nothing to seed beyond that.
    console.info("[tab-steward] installed with default settings");
  }
  await buildContextMenus();
  await syncAlarms();
  await syncSleepAlarm();
  await housekeeping();
  await primeTracker();
  await refreshBadge();
});

chrome.runtime.onStartup?.addListener(async () => {
  await store.ready;
  // Menus do not survive a browser restart; without this the right-click menu
  // stays empty until some unrelated tab event rebuilds it.
  await buildContextMenus();
  await syncAlarms();
  await syncSleepAlarm();
  await primeTracker();
  await refreshBadge();
});

// Listener registration must stay synchronous — see bootstrap() at the bottom.
installTracker();

/* ====================================================================== *
 * alarms
 * ====================================================================== */

chrome.alarms.onAlarm.addListener(async (alarm) => {
  await store.ready;
  if (alarm.name === ALARM_FLUSH) {
    await flush();
    return;
  }
  if (alarm.name === ALARM_AUTOSLEEP) {
    await runAutoSleep({ notify: true });
    await refreshBadge();
    return;
  }
  if (alarm.name === ALARM_HOUSEKEEP) {
    await housekeeping();
    await refreshBadge();
    return;
  }
  if (alarm.name.startsWith(ALARM_PREFIX)) {
    const id = alarm.name.slice(ALARM_PREFIX.length);
    await fireReminder(id);
  }
});

/* ====================================================================== *
 * duplicate detection
 * ====================================================================== */

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // A URL change is a navigation; a bare "complete" is a reload. Reopening a
  // discarded tab after cleanup also ends in "complete" with the same address,
  // and that must not be mistaken for a freshly opened duplicate.
  if (!changeInfo.url) return;
  if (!tab.url) return;
  const key = `${tabId}:${urlKey(tab.url)}`;
  if (checkedDupeKeys.has(key)) return;
  checkedDupeKeys.add(key);
  if (checkedDupeKeys.size > 400) checkedDupeKeys.clear();

  await store.ready;
  if (!isOn(store.get("settings"), "duplicates")) return;
  if (await isSuppressed()) return;
  const verdict = await inspectNewTab(tab);
  if (!verdict) return;

  // Extension pages get the same two choices inline.
  chrome.runtime.sendMessage({ type: "dupe:found", payload: verdict }).catch(() => {});

  const nid = `${DUPE_NID_PREFIX}${tabId}-${Date.now()}`;
  await chrome.storage?.session?.set?.({
    [nid]: {
      existing: { id: verdict.existing.id, windowId: verdict.existing.windowId },
      newTab: { id: tabId, windowId: tab.windowId },
    },
  }).catch?.(() => {});

  if (chrome.notifications?.create) {
    await chrome.notifications
      .create(nid, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("assets/icon128.png"),
        title: "发现重复标签",
        message: `${verdict.title || verdict.existing.title || verdict.existing.url}\n${verdict.location} 已有相同网址的标签`,
        // Negative priorities are dropped outright on Windows/Linux/macOS.
        priority: 1,
        // Unlike a reminder, this prompt is informational: Windows collapses it
        // after a few seconds instead of keeping it over every other window.
        requireInteraction: false,
        // Ignoring the prompt keeps both tabs; that is the default outcome.
        buttons: [{ title: "关闭这个并跳转" }, { title: "切换到已有标签" }],
      })
      .catch(() => null);
  }

  // The OS may leave the collapsed notice in the notification centre. Clear it
  // as well so "10 seconds" means gone, not just out of sight. unref() only
  // exists under the Node test stub; in the worker the timer is a number.
  const ttl = setTimeout(() => {
    chrome.notifications?.clear?.(nid)?.catch?.(() => {});
  }, DUPE_NOTIFICATION_TTL_MS);
  ttl?.unref?.();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const key of checkedDupeKeys) if (key.startsWith(`${tabId}:`)) checkedDupeKeys.delete(key);
});

/* ====================================================================== *
 * screenshot preview (experimental, default off)
 * ====================================================================== */

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await store.ready;
  const settings = store.get("settings") || {};
  if (!isOn(settings, "screenshotPreview")) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  const win = await chrome.windows.get(tab.windowId).catch(() => null);
  if (!win?.focused) return;
  await capturePreview(tab);
});

/* ====================================================================== *
 * window bookkeeping
 * ====================================================================== */

chrome.windows.onRemoved.addListener(async (windowId) => {
  await store.ready;
  const names = { ...(store.get("windows") || {}) };
  if (names[windowId]) {
    delete names[windowId];
    await store.set("windows", names);
  }
});

/* ====================================================================== *
 * notifications
 * ====================================================================== */

chrome.notifications?.onClicked?.addListener(async (nid) => {
  await store.ready;
  if (nid.startsWith(REMINDER_NID_PREFIX)) {
    const id = nid.slice(REMINDER_NID_PREFIX.length);
    const reminder = listReminders({ includePast: true }).find((r) => r.id === id);
    if (reminder) await gotoReminder(reminder);
    await chrome.notifications.clear(nid).catch(() => {});
  }
});

chrome.notifications?.onButtonClicked?.addListener(async (nid, buttonIndex) => {
  await store.ready;
  if (nid.startsWith(REMINDER_NID_PREFIX)) {
    const id = nid.slice(REMINDER_NID_PREFIX.length);
    if (buttonIndex === 0) await snoozeReminder(id, 10);
    else if (buttonIndex === 1) {
      const reminder = listReminders({ includePast: true }).find((r) => r.id === id);
      if (reminder) await gotoReminder(reminder);
    }
    await chrome.notifications.clear(nid).catch(() => {});
    return;
  }
  if (nid.startsWith(DUPE_NID_PREFIX)) {
    const raw = await chrome.storage?.session?.get?.(nid).catch?.(() => null);
    const info = raw?.[nid];
    // Only these two button presses may close a tab; ignoring the prompt keeps both.
    if (info?.existing && buttonIndex === 0) {
      await closeAndSwitch(info.newTab?.id, info.existing.id, info.existing.windowId);
    } else if (info?.existing && buttonIndex === 1) {
      await switchToTab(info.existing.id, info.existing.windowId);
    }
    await chrome.storage?.session?.remove?.(nid).catch?.(() => {});
    await chrome.notifications.clear(nid).catch(() => {});
  }
});

/* ====================================================================== *
 * context menus — one top-level entry with submenus, mirroring the
 * reference layout: 设定提醒 / 暂存到… / 暂存并关闭到… / 休眠此标签 /
 * 移动到窗口 / 整理所有标签
 * ====================================================================== */

const MENU_ROOT = "ts-root";

/**
 * contextMenus.create is callback-only (it returns undefined), so awaiting it
 * resolves immediately and failures only surface as runtime.lastError. Wait for
 * each callback so parent/child ordering is guaranteed and a rejected create is
 * logged instead of stalling the rest of the tree.
 *
 * Chrome's CreateProperties has no `icons` field: sending one makes create reject
 * with "Unexpected property: 'icons'", and every child then dies with
 * "Cannot find menu item with id ts-root". The only glyph a native item can carry
 * is an emoji written into its title, which is why the action items below start
 * with one. Values (preset minutes, collection names, window labels) stay plain.
 */
const createMenuItem = (props) =>
  new Promise((resolve) => {
    let settled = false;
    const done = (message) => {
      if (settled) return;
      settled = true;
      resolve(message || "");
    };
    try {
      const maybe = chrome.contextMenus.create(
        { ...props, contexts: props.contexts || ["page"] },
        () => done(chrome.runtime.lastError?.message)
      );
      maybe?.catch?.(() => {});
    } catch (err) {
      done(err?.message || String(err));
    }
  });

const removeAllMenus = () =>
  new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      const maybe = chrome.contextMenus.removeAll(() => {
        void chrome.runtime.lastError;
        done();
      });
      maybe?.then?.(done, done);
    } catch {
      done();
    }
  });

async function buildContextMenusOnce() {
  if (!chrome.contextMenus?.create) return;
  await removeAllMenus();

  const create = async (props) => {
    const failure = await createMenuItem(props);
    if (failure) console.warn("[menus] create failed:", props.id, failure);
  };

  await create({ id: MENU_ROOT, title: "Tab Steward — 标签页管理器", contexts: ["page", "selection"] });

  const settings = store.get("settings") || {};
  const on = (id) => isOn(settings, id);

  if (on("reminders")) {
    const presets = settings.reminders?.presets || [5, 15, 30, 60, 120, 480];
    await create({ id: "remind", parentId: MENU_ROOT, title: "⏰ 设定提醒" });
    for (const m of presets) {
      await create({ id: `remind-${m}`, parentId: "remind", title: m < 60 ? `${m} 分钟后` : `${m / 60} 小时后` });
    }
    await create({ id: "remind-custom", parentId: "remind", title: "自定义时间…" });
  }

  const collections = (store.get("collections") || []).filter((c) => on("favorites") || c.id === STASH_ID);
  await create({ id: "stash", parentId: MENU_ROOT, title: "📥 暂存到…" });
  await create({ id: "stash-close", parentId: MENU_ROOT, title: "📦 暂存并关闭到…" });
  for (const col of collections) {
    await create({ id: `stash-${col.id}`, parentId: "stash", title: col.name });
    await create({ id: `stashclose-${col.id}`, parentId: "stash-close", title: col.name });
  }

  if (on("sleep")) {
    await create({ id: "sleep", parentId: MENU_ROOT, title: "🌙 休眠此标签" });
  }

  await create({ id: "move", parentId: MENU_ROOT, title: "🪟 移动到窗口" });
  const windows = await chrome.windows.getAll({}).catch(() => []);
  const ordinals = windowOrdinals(windows);
  for (const w of windows.filter((x) => x.type === "normal")) {
    const stored = (store.get("windows") || {})[w.id];
    const label = windowLabel(w, stored, ordinals.get(w.id));
    await create({ id: `move-${w.id}`, parentId: "move", title: w.focused ? `${label}（当前）` : label });
  }

  if (on("organize")) {
    await create({ id: "organize", parentId: MENU_ROOT, title: "🧹 整理所有标签 (站点 + 收藏区分组)" });
  }
  if (on("sleep")) {
    await create({ id: "sep-a", parentId: MENU_ROOT, type: "separator" });
    await create({ id: "protect-toggle", parentId: MENU_ROOT, title: "🛡️ 保护此站点（不自动休眠）" });
  }
  await create({ id: "dashboard", parentId: MENU_ROOT, title: "📊 打开 Dashboard" });
}

/**
 * Builds are serialised: settings changes and install events can both fire while
 * a rebuild is still awaiting its create callbacks. A second removeAll then wiped
 * half a tree and left the older pass creating orphans. Queue them instead of
 * letting them interleave.
 */
let menuBuildQueue = Promise.resolve();
function buildContextMenus() {
  const run = menuBuildQueue.then(buildContextMenusOnce, buildContextMenusOnce);
  menuBuildQueue = run.catch(() => {});
  return run;
}

const rebuildMenusDebounced = (() => {
  let t = null;
  return () => {
    clearTimeout(t);
    t = setTimeout(() => buildContextMenus(), 250);
  };
})();

chrome.contextMenus?.onClicked?.addListener(async (info, tab) => {
  await store.ready;
  const id = String(info.menuItemId || "");
  try {
    await handleMenuClick(id, info, tab);
  } catch (err) {
    console.error("[menus] click handler failed:", id, err);
    chrome.runtime.sendMessage({ type: "action:failed", payload: { message: String(err?.message || err) } }).catch(() => {});
  }
});

async function handleMenuClick(id, info, tab) {
  if (id.startsWith("remind-")) {
    if (id === "remind-custom") {
      await openDashboard(`reminder=${encodeURIComponent(tab?.url || "")}`);
    } else if (tab) {
      const minutes = Number(id.slice("remind-".length));
      const r = await createReminder({ url: tab.url, title: tab.title, scope: "page", offsetMinutes: minutes });
      const armed = await chrome.alarms.get(`rem:${r.id}`);
      if (!armed) console.error("[reminders] alarm not armed for", r.id);
      // tell every open surface so the user sees it even when system notifications are off
      chrome.runtime.sendMessage({ type: "reminder:created", payload: { reminder: r, armed: !!armed } }).catch(() => {});
      chrome.notifications
        ?.create?.(`rem-set-${r.id}`, {
          type: "basic",
          iconUrl: chrome.runtime.getURL("assets/icon128.png"),
          title: "提醒已创建",
          message: `${r.title}\n${new Date(r.fireAt).toLocaleString()}`,
        })
        .catch?.(() => {});
    }
    return;
  }

  if (id.startsWith("stashclose-") || id.startsWith("stash-")) {
    const close = id.startsWith("stashclose-");
    const collectionId = id.slice(close ? "stashclose-".length : "stash-".length);
    if (!tab) return;
    const r = await stashTabs([tab], { collectionId, close, source: "context-menu" });
    const col = (store.get("collections") || []).find((c) => c.id === collectionId);
    chrome.runtime.sendMessage({ type: "stash:done", payload: { name: col?.name, close } }).catch(() => {});
    void r;
    return;
  }

  switch (id) {
    case "sleep": {
      if (!tab) return;
      if (!canSleep(tab)) {
        chrome.notifications
          ?.create?.(`sleep-skip-${tab.id}`, {
            type: "basic",
            iconUrl: chrome.runtime.getURL("assets/icon128.png"),
            title: "无法休眠此标签",
            message: skipReason(tab),
          })
          .catch?.(() => {});
        return;
      }
      await chrome.tabs.discard(tab.id);
      return;
    }
    case "protect-toggle": {
      if (!tab) return;
      const host = hostname(tab.url);
      const sites = store.get("sites") || {};
      const next = !sites[host]?.protected;
      await protectSite(host, next);
      rebuildMenusDebounced();
      return;
    }
    case "organize": {
      await arrangeAllWindows();
      await applyCollectionsAsGroups(null);
      return;
    }
    case "dashboard":
      await openDashboard();
      return;
  }

  if (id.startsWith("move-")) {
    const windowId = Number(id.slice("move-".length));
    if (!tab || !Number.isFinite(windowId)) return;
    await chrome.tabs.move(tab.id, { windowId, index: -1 });
    await chrome.windows.update(windowId, { focused: true }).catch(() => {});
    await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
  }
}

/* Submenu contents depend on live collections/windows, so refresh the tree
   whenever those change. Debounced: activation fires in bursts. */
chrome.tabs.onActivated.addListener(() => rebuildMenusDebounced());
chrome.windows.onCreated.addListener(() => rebuildMenusDebounced());
chrome.windows.onRemoved.addListener(() => rebuildMenusDebounced());
store.on("collections", () => rebuildMenusDebounced());

/* ====================================================================== *
 * commands
 * ====================================================================== */

async function openDashboard(hash = "") {
  const url = chrome.runtime.getURL(`src/dashboard/index.html${hash ? `?${hash}` : ""}`);
  const existing = await chrome.tabs.query({ url: chrome.runtime.getURL("src/dashboard/index.html") });
  if (existing.length) {
    await chrome.tabs.update(existing[0].id, { active: true });
    await chrome.windows.update(existing[0].windowId, { focused: true }).catch(() => {});
    return existing[0];
  }
  return chrome.tabs.create({ url, active: true });
}

chrome.commands?.onCommand?.addListener(async (command) => {
  if (command === "open-dashboard" || command === "open-search") {
    await openDashboard(command === "open-search" ? "focus=search" : "");
  }
});

chrome.action?.onClicked?.addListener(async () => {
  // a default_popup is set, so this only fires if the popup is removed
  await openDashboard();
});

/* ====================================================================== *
 * message router — only for work the service worker owns
 * ====================================================================== */

const handlers = {
  "sw:ping": () => ({ ok: true, at: Date.now() }),

  "sleep:run": (p) => runAutoSleep({ notify: p?.notify !== false }),
  "sleep:plan": () => planAutoSleep().then((plan) => ({
    candidates: plan.candidates.length,
    skipped: plan.skipped.length,
    thresholdMs: plan.thresholdMs,
    idleMinutes: plan.idleMinutes,
    sample: plan.candidates.slice(0, 10).map((c) => ({ id: c.tab.id, title: c.tab.title, url: c.tab.url, idleMinutes: Math.round(c.idleMs / 60000) })),
  })),
  "sleep:now": (p) => sleepIdleNow({ idleMinutes: p?.idleMinutes ?? 60 }),
  "sleep:policy": () => describePolicy(),

  "dupe:scan": (p) => scanDuplicates({ windowId: p?.windowId, scope: p?.scope, keep: p?.keep }).then((groups) => ({
    groups: groups.map((g) => ({
      key: g.key,
      url: g.url,
      title: g.title,
      site: g.site,
      count: g.tabs.length,
      keepId: g.keepId,
      removable: g.removable,
      windows: g.windows,
      tabs: g.tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, windowId: t.windowId, active: t.active, discarded: t.discarded, pinned: t.pinned })),
    })),
  })),
  "dupe:close": (p) => closeDuplicates({ windowId: p?.windowId, scope: p?.scope, keep: p?.keep }),

  "organize:arrange": (p) => (p?.scope === "all" ? arrangeAllWindows() : arrangeBySite(p.windowId)),
  "organize:groups": (p) => applyCollectionsAsGroups(p?.windowId),
  "organize:suggestions": (p) => buildSuggestions(p || {}),

  "reminder:fire": (p) => fireReminder(p.id),
  "reminder:sync": () => syncAlarms(),
  "badge:refresh": () => refreshBadge(),

  "capture:preview": async (p) => {
    const tab = p?.tab || (await chrome.tabs.get(p.tabId).catch(() => null));
    return tab ? capturePreview(tab) : null;
  },
  "capture:get": (p) => getPreview(p.url),
  "capture:permission": () => hasCapturePermission(),

  "dashboard:open": (p) => openDashboard(p?.hash || ""),

  notify: async (p) => {
    if (!chrome.notifications?.create) return null;
    return chrome.notifications.create(p.id || `n-${Date.now()}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("assets/icon128.png"),
      title: p.title || "Tab Steward",
      message: p.message || "",
      priority: p.priority ?? 0,
      buttons: p.buttons,
    });
  },

  "llm:request": (p) => llmRequest({ tabs: p.tabs, goal: p.goal }),
  "llm:apply": (p) => llmApply(p.plan || {}),

  "analytics:summary": () => analyticsSummary(),
};

/** Every routed call that does work owned by a switchable module. */
const HANDLER_MODULE = {
  "sleep:run": "sleep",
  "sleep:plan": "sleep",
  "sleep:now": "sleep",
  "sleep:policy": "sleep",
  "dupe:scan": "duplicates",
  "dupe:close": "duplicates",
  "organize:arrange": "organize",
  "organize:groups": "organize",
  "organize:suggestions": "organize",
  "reminder:fire": "reminders",
  "reminder:sync": "reminders",
  "badge:refresh": "reminders",
  "capture:preview": "screenshotPreview",
  "capture:get": "screenshotPreview",
  "capture:permission": "screenshotPreview",
  "llm:request": "llm",
  "llm:apply": "llm",
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;

  // broadcasts that the service worker emits to pages are ignored here
  if (message.type.includes(":") && /^(dupe:found|reminder:due|sleep:auto|store:changed)$/.test(message.type)) return false;

  const handler = handlers[message.type];
  if (!handler) return false;
  const required = HANDLER_MODULE[message.type];

  (async () => {
    await store.ready;
    if (required && !isOn(store.get("settings"), required)) {
      sendResponse({ __error: `「${moduleById(required)?.label || required}」模块未启用` });
      return;
    }
    try {
      const result = await handler(message.payload || {}, sender);
      sendResponse(result === undefined ? null : result);
    } catch (err) {
      console.error(`[sw] ${message.type} failed`, err);
      sendResponse({ __error: String(err?.message || err) });
    }
  })();
  return true;
});

/* ====================================================================== *
 * settings reactions
 * ====================================================================== */

store.on("settings", async () => {
  await syncSleepAlarm();
  await syncAlarms();
  await refreshBadge();
  rebuildMenusDebounced();
});

/* ====================================================================== *
 * bootstrap — everything after listener registration may be async
 * ====================================================================== */

async function bootstrap() {
  await store.ready;
  await ensureHousekeepingAlarms();
  await syncSleepAlarm();
  await syncAlarms();
  await primeTracker();
  await refreshBadge();
  await buildContextMenus();
}

bootstrap().catch((err) => console.error("[sw] bootstrap failed", err));
