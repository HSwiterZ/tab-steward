import { store } from "./storage.js";
import { LIMITS } from "./defaults.js";
import { isOn } from "./modules.js";
import { uid, now as ts, hostname, siteOf, urlKey, formatDateTime } from "./utils.js";

export const ALARM_PREFIX = "rem:";
export const ALARM_AUTOSLEEP = "auto-sleep";
export const ALARM_FLUSH = "tracker-flush";
export const ALARM_HOUSEKEEP = "housekeeping";

/** pending = not yet delivered; fired = delivered and awaiting the user's action. */
export const ACTIVE_STATUSES = ["pending", "fired"];
const isActive = (r) => ACTIVE_STATUSES.includes(r.status);

export function listReminders({ includePast = false, scope, url } = {}) {
  let list = store.get("reminders") || [];
  if (!includePast) list = list.filter(isActive);
  if (scope) list = list.filter((r) => r.scope === scope);
  if (url) {
    const key = urlKey(url);
    const host = hostname(url);
    list = list.filter((r) => r.urlKey === key || r.host === host || r.site === siteOf(url));
  }
  return list.sort((a, b) => a.fireAt - b.fireAt);
}

export function getReminder(id) {
  return (store.get("reminders") || []).find((r) => r.id === id) || null;
}

/**
 * @param {object} opts
 * @param {string} opts.url            target page
 * @param {string} [opts.title]
 * @param {'page'|'site'} [opts.scope] 'site' reminds for any tab on that host
 * @param {number} [opts.fireAt]       absolute ms timestamp
 * @param {number} [opts.offsetMinutes] relative, used when fireAt is absent
 * @param {string} [opts.note]
 */
export async function createReminder({ url, title, scope = "page", fireAt, offsetMinutes, note = "" }) {
  if (!url) throw new Error("缺少目标网址");
  const settings = store.get("settings") || {};
  const offset = offsetMinutes ?? settings.reminders?.defaultOffsetMinutes ?? 30;
  const when = fireAt ?? ts() + offset * 60_000;
  if (when <= ts()) throw new Error("提醒时间必须晚于现在");

  const reminder = {
    id: uid("rem"),
    url,
    urlKey: urlKey(url),
    host: hostname(url),
    site: siteOf(url),
    title: title || url,
    scope,
    fireAt: when,
    note,
    createdAt: ts(),
    status: "pending",
    snoozeCount: 0,
    lastNotifiedAt: 0,
  };

  let list = [reminder, ...(store.get("reminders") || [])];
  if (list.length > LIMITS.reminders) list = list.slice(0, LIMITS.reminders);
  await store.set("reminders", list);
  scheduleAlarm(reminder);
  return reminder;
}

export async function updateReminder(id, patch) {
  const list = (store.get("reminders") || []).map((r) => (r.id === id ? { ...r, ...patch } : r));
  await store.set("reminders", list);
  const updated = list.find((r) => r.id === id);
  // Re-arming a *fired* reminder would re-fire it forever: fireAt is already in
  // the past, so the alarm would come back in ~1s and loop.
  if (updated && updated.status === "pending") scheduleAlarm(updated);
  else clearAlarm(id);
  return updated || null;
}

export async function cancelReminder(id) {
  const r = getReminder(id);
  await updateReminder(id, { status: "cancelled", cancelledAt: ts() });
  clearAlarm(id);
  await refreshBadge();
  return r;
}

export async function snoozeReminder(id, minutes = 10) {
  const r = getReminder(id);
  if (!r) return null;
  const fireAt = ts() + minutes * 60_000;
  clearAlarm(id);
  return updateReminder(id, { fireAt, status: "pending", snoozeCount: (r.snoozeCount || 0) + 1, lastNotifiedAt: 0 });
}

export async function markDone(id) {
  const r = await updateReminder(id, { status: "done", doneAt: ts() });
  clearAlarm(id);
  await refreshBadge();
  return r;
}

export async function removeReminder(id) {
  await store.set("reminders", (store.get("reminders") || []).filter((r) => r.id !== id));
  clearAlarm(id);
  await refreshBadge();
}

export function dueReminders(reference = Date.now()) {
  // a fired reminder is by definition awaiting the user's action, regardless of
  // whether its clock time has technically passed
  return (store.get("reminders") || []).filter((r) => isActive(r) && (r.status === "fired" || r.fireAt <= reference));
}

export function upcomingReminders(withinMinutes = 60, reference = Date.now()) {
  const limit = reference + withinMinutes * 60_000;
  return (store.get("reminders") || []).filter((r) => r.status === "pending" && r.fireAt > reference && r.fireAt <= limit);
}

/* ------------------------------------------------------------------ *
 * alarms
 * ------------------------------------------------------------------ */

export function scheduleAlarm(reminder) {
  if (!chrome.alarms?.create) return;
  if (!isOn(store.get("settings"), "reminders")) return;
  const delay = Math.max(0.02, (reminder.fireAt - Date.now()) / 60_000);
  chrome.alarms.create(ALARM_PREFIX + reminder.id, { delayInMinutes: delay });
}

export function clearAlarm(id) {
  chrome.alarms?.clear?.(ALARM_PREFIX + id).catch?.(() => {});
}

/** Re-arm every pending reminder — needed after a browser restart or a module flip. */
export async function syncAlarms() {
  if (!chrome.alarms?.getAll) return;
  const settings = store.get("settings") || {};
  const existing = await chrome.alarms.getAll();
  if (!isOn(settings, "reminders")) {
    // Off means no alarm left standing; the records survive so re-enabling works.
    for (const alarm of existing) if (alarm.name.startsWith(ALARM_PREFIX)) chrome.alarms.clear(alarm.name);
    await refreshBadge();
    return;
  }
  const wanted = new Set((store.get("reminders") || []).filter((r) => r.status === "pending").map((r) => ALARM_PREFIX + r.id));
  for (const alarm of existing) {
    if (alarm.name.startsWith(ALARM_PREFIX) && !wanted.has(alarm.name)) chrome.alarms.clear(alarm.name);
  }
  for (const r of store.get("reminders") || []) if (r.status === "pending") scheduleAlarm(r);
  await refreshBadge();
}

export async function refreshBadge() {
  const settings = store.get("settings") || {};
  const due = isOn(settings, "reminders") ? dueReminders().length : 0;
  const text = settings.reminders?.badge === false || !due ? "" : String(due);
  await chrome.action?.setBadgeText?.({ text }).catch?.(() => {});
  if (text) await chrome.action?.setBadgeBackgroundColor?.({ color: "#dc2626" }).catch?.(() => {});
  return due;
}

/**
 * Fired from the service worker's onAlarm handler.
 * Returns a description of what was delivered so callers can log or test it.
 */
export async function fireReminder(id) {
  const r = getReminder(id);
  if (!r || r.status !== "pending") return null;
  const settings = store.get("settings") || {};
  if (!isOn(settings, "reminders")) return null;
  const delivered = [];

  // flip to "fired" first: updateReminder re-arms pending reminders, and a
  // past-due fireAt would otherwise schedule an immediate re-fire
  await updateReminder(id, { status: "fired", firedAt: ts(), lastNotifiedAt: ts(), notifiedCount: (r.notifiedCount || 0) + 1 });

  if (settings.reminders?.systemNotification !== false && chrome.notifications?.create) {
    const nid = `reminder-${r.id}`;
    await chrome.notifications
      .create(nid, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("assets/icon128.png"),
        title: r.note ? `提醒：${r.note}` : "时间到了",
        message: r.title,
        priority: 2,
        requireInteraction: settings.notifications?.sticky !== false,
        buttons: [{ title: "续时 10 分钟" }, { title: "打开页面" }],
      })
      .catch(() => null);
    delivered.push("notification");
  }

  if (settings.reminders?.badge !== false) {
    await refreshBadge();
    delivered.push("badge");
  }

  if (settings.reminders?.dashboardBanner !== false) delivered.push("banner");

  chrome.runtime
    .sendMessage({ type: "reminder:due", payload: { reminder: r, delivered } })
    .catch(() => {});

  return { reminder: r, delivered };
}

export async function gotoReminder(reminder) {
  const tabs = await chrome.tabs.query({});
  const match =
    tabs.find((t) => urlKey(t.url) === reminder.urlKey) ||
    (reminder.scope === "site" ? tabs.find((t) => siteOf(t.url) === reminder.site) : null);
  if (match) {
    await chrome.windows.update(match.windowId, { focused: true }).catch(() => {});
    await chrome.tabs.update(match.id, { active: true });
    return { tabId: match.id, windowId: match.windowId, reused: true };
  }
  const tab = await chrome.tabs.create({ url: reminder.url, active: true });
  return { tabId: tab.id, windowId: tab.windowId, reused: false };
}

export function describeReminder(r, reference = Date.now()) {
  const diff = r.fireAt - reference;
  const abs = formatDateTime(r.fireAt);
  if (diff <= 0) return { label: "已到时", abs, overdue: -diff };
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return { label: `${mins} 分钟后`, abs, overdue: 0 };
  const hours = Math.round(mins / 60);
  if (hours < 24) return { label: `${hours} 小时后`, abs, overdue: 0 };
  return { label: `${Math.round(hours / 24)} 天后`, abs, overdue: 0 };
}

/**
 * The two always-on maintenance alarms. Re-creating a periodic alarm restarts
 * its clock, so only create what is missing — otherwise a busy tab session
 * starves both timers on every service-worker wake.
 */
export async function ensureHousekeepingAlarms() {
  if (!chrome.alarms?.create) return;
  for (const { name, periodInMinutes } of [
    { name: ALARM_FLUSH, periodInMinutes: 1 },
    { name: ALARM_HOUSEKEEP, periodInMinutes: 60 * 12 },
  ]) {
    if (await chrome.alarms.get(name)) continue;
    chrome.alarms.create(name, { periodInMinutes });
  }
}
