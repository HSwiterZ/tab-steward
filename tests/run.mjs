/**
 * Automated checks for the extension's core logic, run against the strict
 * chrome test double in Node:  node tests/run.mjs
 */
import assert from "node:assert/strict";
import { installChromeStub } from "./chrome-stub.mjs";

const chrome = installChromeStub({
  tabs: [
    { id: 101, url: "https://github.com/a", title: "Repo A", lastAccessed: Date.now() - 10 * 60_000 },
    { id: 102, url: "https://github.com/a", title: "Repo A", active: true, lastAccessed: Date.now() },
    { id: 103, url: "https://news.ycombinator.com/news", title: "Hacker News", lastAccessed: Date.now() - 3 * 3600_000 },
    { id: 104, url: "https://news.ycombinator.com/news", title: "Hacker News", discarded: true, lastAccessed: Date.now() - 3 * 3600_000 },
    { id: 105, url: "https://arxiv.org/abs/1706.03762", title: "Attention Is All You Need", pinned: true, lastAccessed: Date.now() - 40 * 60_000 },
    { id: 106, url: "https://juejin.cn/post/7211", title: "MV3 迁移踩坑记录", lastAccessed: Date.now() - 5 * 3600_000 },
    { id: 107, url: "https://example-shop.com/cart", title: "机械键盘 · 购物车", audible: true, lastAccessed: Date.now() - 90 * 60_000 },
  ],
});

const { store } = await import("../src/core/storage.js");
const { defaultSettings, defaultCollections } = await import("../src/core/defaults.js");
const reminders = await import("../src/core/reminders.js");
const stats = await import("../src/core/stats.js");
const utils = await import("../src/core/utils.js");
const dupes = await import("../src/core/dupes.js");
const collections = await import("../src/core/collections.js");
const trash = await import("../src/core/trash.js");
const backup = await import("../src/core/backup.js");
const organize = await import("../src/core/organize.js");
const search = await import("../src/core/search.js");
const actions = await import("../src/core/actions.js");

/* ------------------------------------------------------------------ */

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

async function resetDb() {
  await store.set("settings", defaultSettings());
  await store.set("collections", defaultCollections());
  await store.set("stats", {});
  await store.set("sites", {});
  await store.set("reminders", []);
  await store.set("snapshots", []);
  await store.set("trash", []);
  await store.set("windows", {});
  await store.set("searches", { recent: [], frequent: {} });
  await store.set("lockedCards", []);
  await chrome.alarms.clearAll();
  chrome.__state.notifications.length = 0;
  chrome.__state.discarded.length = 0;
}

/* ============================ reminders ============================ */

test("提醒：创建后挂上一次性闹钟", async () => {
  await resetDb();
  const r = await reminders.createReminder({ url: "https://a.com/1", title: "A", offsetMinutes: 30 });
  assert.equal(r.status, "pending");
  const alarm = await chrome.alarms.get(`rem:${r.id}`);
  assert.ok(alarm, "闹钟应存在");
  assert.ok(alarm.scheduledTime > Date.now() + 29 * 60_000, "计划时间应在 30 分钟后附近");
});

test("提醒：时间在过去会被拒绝", async () => {
  await resetDb();
  await assert.rejects(() => reminders.createReminder({ url: "https://a.com/1", fireAt: Date.now() - 1000 }));
  await assert.rejects(() => reminders.createReminder({ title: "没有网址" }));
});

test("提醒：触发后翻成 fired 且不再重挂闹钟（刷屏回归）", async () => {
  await resetDb();
  const r = await reminders.createReminder({ url: "https://a.com/2", title: "B", offsetMinutes: 30 });
  const first = await reminders.fireReminder(r.id);
  assert.ok(first, "首次触发应有结果");
  assert.deepEqual(first.delivered.sort(), ["badge", "banner", "notification"]);
  assert.equal((await chrome.alarms.get(`rem:${r.id}`)), undefined, "触发后闹钟必须已清除，否则会 1 秒一次自我重发");
  assert.equal(store.get("reminders").find((x) => x.id === r.id).status, "fired");
  assert.equal(await reminders.fireReminder(r.id), null, "重复触发应为空操作");
  assert.equal(chrome.__state.notifications.filter((n) => n.id.startsWith("reminder-")).length, 1, "只应发一条系统通知");
});

test("提醒：已触发未处理仍算待办，续时后重新挂闹钟", async () => {
  await resetDb();
  const r = await reminders.createReminder({ url: "https://a.com/3", title: "C", offsetMinutes: 30 });
  await reminders.fireReminder(r.id);
  assert.ok(reminders.dueReminders().some((x) => x.id === r.id), "fired 仍应出现在横幅待办里");
  assert.equal(await chrome.action.getBadgeText({}), "1", "角标应计数");

  const snoozed = await reminders.snoozeReminder(r.id, 10);
  assert.equal(snoozed.status, "pending");
  assert.ok(await chrome.alarms.get(`rem:${r.id}`), "续时应重新挂闹钟");
  assert.equal(reminders.dueReminders().length, 0, "续时后不再算到时");

  await reminders.markDone(r.id);
  assert.equal(store.get("reminders").find((x) => x.id === r.id).status, "done");
  assert.equal(await chrome.alarms.get(`rem:${r.id}`), undefined);
  assert.equal(await chrome.action.getBadgeText({}), "");
});

test("提醒：syncAlarms 只重挂 pending，不重放已提醒的", async () => {
  await resetDb();
  const a = await reminders.createReminder({ url: "https://a.com/4", title: "D", offsetMinutes: 20 });
  const b = await reminders.createReminder({ url: "https://a.com/5", title: "E", offsetMinutes: 20 });
  await reminders.fireReminder(a.id);
  await chrome.alarms.clearAll();
  await reminders.syncAlarms();
  assert.equal(await chrome.alarms.get(`rem:${a.id}`), undefined, "已触发的不应重放");
  assert.ok(await chrome.alarms.get(`rem:${b.id}`), "未触发的应重新挂上");
});

test("提醒：站点范围按站点匹配", async () => {
  await resetDb();
  await reminders.createReminder({ url: "https://github.com/x", title: "G", scope: "site", offsetMinutes: 5 });
  assert.equal(reminders.listReminders({ url: "https://github.com/y" }).length, 1);
  assert.equal(reminders.listReminders({ url: "https://arxiv.org/abs/1" }).length, 0);
});

/* ============================ stats / idle ============================ */

test("闲置度：随闲置时长单调上升且分段正确", () => {
  const samples = [
    [0, 0],
    [5 * 60_000, 20],
    [30 * 60_000, 45],
    [3 * 3600_000, 70],
    [12 * 3600_000, 90],
    [10 * 86400_000, 100],
  ];
  let prev = -1;
  for (const [ms, ceiling] of samples) {
    const score = stats.idleScore(ms);
    assert.ok(score > prev, `${ms}ms 的分数应高于上一档`);
    assert.ok(score <= ceiling, `${ms}ms 不应超过 ${ceiling}`);
    prev = score;
  }
  assert.equal(stats.bandForScore(5).id, "active");
  assert.equal(stats.bandForScore(95).id, "severe");
});

test("闲置度：活动标签恒为 0，休眠标签仍计入闲置", () => {
  const now = Date.now();
  const active = stats.idleMsFor({ active: true, lastAccessed: now - 86400000 }, null, now);
  assert.equal(active, 0);
  const idle = stats.idleMsFor({ active: false, discarded: true, lastAccessed: now - 3600_000 }, null, now);
  assert.ok(idle >= 3600_000 - 1000);
});

test("站点卡片：聚合数量、重复数与休眠计数", async () => {
  await resetDb();
  const raw = await chrome.tabs.query({});
  const enriched = stats.enrichTabs(raw);
  const cards = stats.buildSiteCards(enriched);
  const gh = cards.find((c) => c.site === "github.com");
  assert.equal(gh.tabs.length, 2);
  assert.equal(gh.dupeCount, 1, "同 URL 两个应记一次重复");
  const hn = cards.find((c) => c.site === "ycombinator.com");
  assert.equal(hn.discarded, 1);
  assert.ok(cards.every((c) => c.avgIdle >= 0 && c.avgIdle <= 100));
});

/* ============================ urls / dupes ============================ */

test("urlKey：忽略锚点、跟踪参数与结尾斜杠", () => {
  assert.equal(utils.urlKey("https://ex.com/path/?utm_source=x&a=1#frag"), utils.urlKey("https://ex.com/path?a=1"));
  assert.equal(utils.urlKey("https://ex.com/p/"), utils.urlKey("https://ex.com/p"));
  assert.equal(utils.urlKey("https://ex.com"), utils.urlKey("https://ex.com/"));
  assert.equal(utils.urlKey("https://ex.com/a?b=1"), utils.urlKey("https://ex.com/a?b=1"));
  assert.notEqual(utils.urlKey("https://ex.com/a?b=1"), utils.urlKey("https://ex.com/a?b=2"), "真实参数差异要保留");
  assert.equal(utils.urlKey("https://ex.com/path?fbclid=1"), "https://ex.com/path", "只剩空问号时要去掉 ?");
  assert.equal(utils.urlKey("chrome://extensions/"), "chrome://extensions/", "内部页原样保留");
});

test("重复标签：保留活动/未休眠的那个，固定标签不被列入可关闭", async () => {
  await resetDb();
  const tabs = await chrome.tabs.query({});
  const groups = dupes.findDuplicateGroups(tabs, { keep: "active" });
  const hn = groups.find((g) => g.host === "news.ycombinator.com");
  assert.ok(hn, "应识别出 HN 重复");
  assert.ok(hn.removable.includes(104), "休眠的那个可关闭");
  assert.ok(!hn.removable.includes(102));
  const gh = groups.find((g) => g.host === "github.com");
  assert.ok(gh.removable.includes(101));
});

test("重复标签：固定标签永远不进可关闭名单", () => {
  const tabs = [
    { id: 201, url: "https://a.com/x", windowId: 1, index: 0, pinned: true },
    { id: 202, url: "https://a.com/x", windowId: 1, index: 1 },
    { id: 203, url: "https://a.com/x", windowId: 1, index: 2, pinned: true },
  ];
  const g = dupes.findDuplicateGroups(tabs, { keep: "first" })[0];
  assert.equal(g.keepId, 201, "固定标签可以当幸存者");
  assert.deepEqual(g.removable, [202], "只有非固定的那个可被关闭");
  assert.deepEqual(dupes.findDuplicateGroups([tabs[0], tabs[2]])[0].removable, [], "全是固定标签时一个都不关");
});

test("重复标签：浏览器内部页不参与", () => {
  assert.equal(dupes.isTrackable("chrome://extensions/"), false);
  assert.equal(dupes.isTrackable("chrome-extension://abc/x.html"), false);
  assert.equal(dupes.isTrackable("https://a.com/"), true);
});

test("重复标签：关闭后给出可撤销的快照", async () => {
  await resetDb();
  const res = await dupes.closeDuplicates({ keep: "active" });
  assert.ok(res.closed >= 2);
  assert.equal(res.undo.length, res.closed);
  assert.ok(res.undo.every((u) => u.url && typeof u.windowId === "number"));
  const remaining = await chrome.tabs.query({});
  assert.equal(remaining.filter((t) => utils.hostname(t.url) === "news.ycombinator.com").length, 1);
});

/* ============================ collections / trash ============================ */

test("收藏区：暂存保留标签，保存并关闭会关掉标签", async () => {
  await resetDb();
  const before = (await chrome.tabs.query({})).length;
  const kept = await collections.stashTabs([{ id: 103, url: "https://news.ycombinator.com/news", title: "HN" }], { close: false });
  assert.equal(kept.closed, 0);
  assert.equal((await chrome.tabs.query({})).length, before);
  assert.equal((await chrome.tabs.query({})).length, before, "保存但保留标签不应关标签");
  const closed = await collections.stashTabs([{ id: 106, url: "https://juejin.cn/post/7211", title: "掘金" }], { close: true, collectionId: "stash" });
  assert.equal(closed.closed, 1);
  assert.equal((await chrome.tabs.query({})).length, before - 1, "保存并关闭应少一个标签");
  assert.equal(collections.stashCollection().items.length, 2);
});

test("收藏区：跨区移动与区内排序", async () => {
  await resetDb();
  const col = await collections.createCollection("论文");
  const a = collections.makeItem({ url: "https://a.com/1", title: "1" });
  const b = collections.makeItem({ url: "https://a.com/2", title: "2" });
  await collections.addItems("stash", [a, b]);
  await collections.moveItemBetween(a.id, "stash", col.id, -1);
  assert.equal(collections.getCollection("stash").items.map((i) => i.id).join(), b.id);
  assert.equal(collections.getCollection(col.id).items.map((i) => i.id).join(), a.id);
  const c = collections.makeItem({ url: "https://a.com/3", title: "3" });
  await collections.addItems(col.id, [c]);
  await collections.reorderItems(col.id, c.id, 0);
  assert.equal(collections.getCollection(col.id).items.map((i) => i.id).join(), `${c.id},${a.id}`);
});

test("回收站：删除收藏项/收藏区后可恢复", async () => {
  await resetDb();
  const col = await collections.createCollection("临时");
  const item = collections.makeItem({ url: "https://a.com/x", title: "X" });
  await collections.addItems(col.id, [item]);
  await collections.removeItem(col.id, item.id);
  assert.equal(trash.listTrash().length, 1);
  await collections.deleteCollection(col.id);
  assert.equal(trash.listTrash().length, 2);
  assert.ok(!collections.getCollection(col.id));

  const entries = trash.listTrash();
  const restoredCol = await trash.restoreEntry(entries.find((e) => e.kind === "collection").id);
  assert.ok(restoredCol.ok);
  assert.ok(collections.getCollection(col.id), "收藏区应回来");
  const restoredItem = await trash.restoreEntry(entries.find((e) => e.kind === "item").id);
  assert.ok(restoredItem.ok);
  assert.equal(collections.getCollection(col.id).items.length, 1);
});

test("回收站：所属收藏区已消失时恢复给出错误而不是静默失败", async () => {
  await resetDb();
  const item = collections.makeItem({ url: "https://a.com/y", title: "Y" });
  await collections.addItems("stash", [item]);
  await collections.removeItem("stash", item.id);
  await store.set("collections", collections.listCollections().map((c) => (c.id === "stash" ? { ...c, items: [] } : c)));
  await store.set("collections", (store.get("collections") || []).filter((c) => c.id !== "stash"));
  const entry = trash.listTrash()[0];
  const res = await trash.restoreEntry(entry.id);
  assert.equal(res.ok, false);
  assert.match(res.error, /收藏区/);
});

/* ============================ backup ============================ */

test("备份：导出→校验→合并/覆盖", async () => {
  await resetDb();
  const col = await collections.createCollection("导出区");
  await collections.addItems(col.id, [collections.makeItem({ url: "https://a.com/1", title: "one" })]);
  const doc = backup.buildBackup({});
  assert.equal(doc.app, "tab-steward");
  const check = backup.validateBackup(doc);
  assert.ok(check.ok, check.errors.join("; "));
  assert.ok(check.summary.sections.find((s) => s.key === "collections").incoming === 2);

  const bad = backup.validateBackup({ app: "tab-steward", collections: [{ name: "缺 id" }] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /id/.test(e)));

  await collections.deleteCollection(col.id);
  assert.ok(!collections.getCollection(col.id), "先确认已被删除");
  const merged = await backup.applyBackup(doc, { mode: "merge" });
  assert.equal(merged.errors.length, 0);
  assert.ok(collections.getCollection(col.id), "合并应找回被删的收藏区");

  await backup.applyBackup({ ...doc, collections: [{ id: "only", name: "唯一", kind: "custom", items: [] }] }, { mode: "overwrite" });
  assert.deepEqual(store.get("collections").map((c) => c.id), ["only"]);
});

/* ============================ organize ============================ */

test("整理：同站点标签排到相邻位置", async () => {
  await resetDb();
  const interleaved = [
    { id: 201, index: 0, url: "https://x.com/1", title: "x1" },
    { id: 202, index: 1, url: "https://y.com/1", title: "y1" },
    { id: 203, index: 2, url: "https://x.com/2", title: "x2" },
    { id: 204, index: 3, url: "https://y.com/2", title: "y2" },
  ];
  chrome.__state.tabs.length = 0;
  chrome.__state.tabs.push(...interleaved.map((t) => ({ ...t, windowId: 1, active: false, pinned: false })));
  const res = await organize.arrangeBySite(1);
  assert.ok(res.sites === 2);
  const order = chrome.__state.movedTabs.map((m) => m.id);
  assert.ok(order.length > 0, "应产生移动");
  const finalIndex = new Map();
  for (const m of chrome.__state.movedTabs.slice().reverse()) finalIndex.set(m.id, m.index);
  const seq = interleaved.map((t) => finalIndex.get(t.id) ?? t.index);
  assert.deepEqual([...seq].sort((a, b) => a - b), [0, 1, 2, 3], "仍应占满 0..3");
});

test("整理建议：识别重复、闲置与分散站点", async () => {
  await resetDb();
  chrome.__state.tabs.length = 0;
  const t0 = Date.now();
  const TAB = { status: "complete", active: false, highlighted: false, pinned: false, audible: false, discarded: false, autoDiscardable: true, groupId: -1, mutedInfo: { muted: false } };
  const mk = (id, url, title, mins, extra = {}) => ({ ...TAB, id, index: id - 300, windowId: 1, url, title, lastAccessed: t0 - mins * 60_000, ...extra });
  chrome.__state.tabs.push(
    mk(300, "https://a.com/1", "A1", 5),
    mk(301, "https://a.com/1", "A1", 5),
    mk(302, "https://a.com/2", "A2", 10),
    mk(303, "https://a.com/3", "A3", 15),
    mk(304, "https://b.com/1", "B1", 600),
    mk(305, "https://b.com/2", "B2", 700),
    mk(306, "https://b.com/3", "B3", 800),
    mk(307, "https://b.com/4", "B4", 900),
    mk(308, "https://c.com/1", "C1", 1200, { active: true })
  );
  const suggestions = await organize.buildSuggestions({ idleThresholdMinutes: 60 });
  const kinds = suggestions.map((s) => s.kind);
  assert.ok(kinds.includes("dedupe"), "应发现重复");
  assert.ok(kinds.includes("sleep"), "应发现闲置");
  assert.ok(kinds.includes("arrange"), "应发现分散站点");
  const sleep = suggestions.find((s) => s.kind === "sleep");
  assert.ok(!sleep.action.payload.tabIds.includes(308), "活动标签不应被建议休眠");
});

/* ============================ search ============================ */

test("搜索：统一检索覆盖标签与暂存，并按来源分组", async () => {
  await resetDb();
  const TAB = { status: "complete", highlighted: false, pinned: false, audible: false, discarded: false, autoDiscardable: true, groupId: -1, mutedInfo: { muted: false }, lastAccessed: Date.now(), windowId: 1 };
  chrome.__state.tabs.length = 0;
  chrome.__state.tabs.push({ ...TAB, id: 400, index: 0, active: true, url: "https://github.com/qoder/repo", title: "Qoder Repo" });
  chrome.__state.tabs.push({ ...TAB, id: 401, index: 1, active: false, url: "https://juejin.cn/post/7211", title: "MV3 迁移踩坑记录" });
  await collections.addItems("stash", [collections.makeItem({ url: "https://juejin.cn/post/7211", title: "MV3 迁移踩坑记录" })]);
  const res = await search.unifiedSearch("MV3");
  assert.ok(res.groups.tab.length >= 1, "标签应命中");
  assert.ok(res.groups.stash.length >= 1, "暂存应命中");
  assert.equal(res.groups.tab[0].source, "tab", "标签组排在最前");
  assert.ok(res.total >= 2);
  const empty = await search.unifiedSearch("");
  assert.equal(empty.total, 0);
});

test("搜索：记录最近与高频，并可遗忘单条", async () => {
  await resetDb();
  await search.recordSearch("标签整理");
  await search.recordSearch("标签整理");
  await search.recordSearch("chrome");
  assert.deepEqual(search.recentSearches(), ["chrome", "标签整理"]);
  assert.equal(search.frequentSearches()[0].term, "标签整理");
  await search.forgetSearch("chrome");
  assert.deepEqual(search.recentSearches(), ["标签整理"]);
});

/* ============================ store ============================ */

test("存储：深合并 settings 且跨上下文同步", async () => {
  await resetDb();
  await store.patch("settings", { autoSleep: { idleMinutes: 45 } });
  assert.equal(store.get("settings").autoSleep.idleMinutes, 45);
  assert.equal(store.get("settings").autoSleep.enabled, true, "同级字段不应被覆盖掉");
  assert.equal(store.get("settings").duplicateWarning, true);

  let seen = null;
  const off = store.on("settings", (v) => {
    seen = v;
  });
  await chrome.storage.local.set({ settings: { ...store.get("settings"), theme: "dark" } });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(store.get("settings").theme, "dark", "外部写入应同步进缓存");
  assert.ok(seen, "订阅者应收到通知");
  off();
});

test("存储：写入真正落到 chrome.storage.local", async () => {
  await resetDb();
  await collections.createCollection("落盘检查");
  const raw = await chrome.storage.local.get("collections");
  assert.ok(raw.collections.some((c) => c.name === "落盘检查"));
});

/* ============================ 窗口状态 ============================ */

test("聚焦标签：最大化窗口不会被缩回 normal 尺寸", async () => {
  await resetDb();
  const win = chrome.__state.windows[0];
  const before = win.state;
  const tab = await chrome.tabs.create({ url: "https://focus-state.test/", active: false });
  try {
    win.state = "maximized";
    await actions.focusTab(tab.id, win.id);
    assert.equal(win.state, "maximized", "focusTab 不该把最大化窗口退回 normal");
    assert.equal(win.focused, true);
    assert.equal((await chrome.tabs.get(tab.id)).active, true);
  } finally {
    win.state = before;
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
});

test("聚焦标签：最小化窗口仍要被拉回可见状态", async () => {
  await resetDb();
  const win = chrome.__state.windows[0];
  const before = win.state;
  const tab = await chrome.tabs.create({ url: "https://focus-min.test/", active: false });
  try {
    win.state = "minimized";
    await actions.focusTab(tab.id, win.id);
    assert.equal(win.state, "normal", "最小化的窗口不恢复就看不见");
  } finally {
    win.state = before;
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
});

test("窗口命名：绝不把 Chrome 内部窗口 id 摆给用户看", async () => {
  await resetDb();
  // Real Chrome hands out ids like 83959995; the mock seed uses 1/2/3, which is
  // exactly why this never showed up during development.
  const big = { id: 83959995, type: "normal", state: "normal", focused: false };
  const small = { id: 42, type: "normal", state: "normal", focused: true };
  const popup = { id: 99, type: "popup", state: "normal", focused: false };
  chrome.__state.windows.push(big, small, popup);
  const tab = await chrome.tabs.create({ url: "https://windowlabel.test/dup", title: "窗口命名探针", windowId: big.id, active: false });
  try {
    const wins = chrome.__state.windows;
    const ord = actions.windowOrdinals(wins);
    const normalIds = wins.filter((w) => w.type === "normal").map((w) => w.id).sort((a, b) => a - b);
    assert.deepEqual([...ord.keys()], normalIds, "只给普通窗口编号，按 id 升序");
    assert.ok(!ord.has(99), "popup 不参与编号");
    assert.equal(ord.get(big.id), normalIds.indexOf(big.id) + 1);

    assert.equal(actions.windowLabel(big, undefined, ord.get(big.id)), `窗口 ${normalIds.indexOf(big.id) + 1}`);
    assert.equal(actions.windowLabel(big, undefined), "窗口", "拿不到序号时宁可只写「窗口」，也不回落到 id");
    assert.equal(actions.windowLabel(big, { name: "阅读" }, 2), "阅读", "用户命名优先于序号");
    assert.equal(actions.windowLabel(popup, undefined), "弹出窗口");

    const res = await search.unifiedSearch("窗口命名探针");
    const hit = res.groups.tab.find((t) => t.payload.tabId === tab.id);
    assert.ok(hit, "搜索应命中这枚探针标签");
    assert.ok(!hit.meta.includes(String(big.id)), `搜索摘要里不该出现原始 id：${hit.meta}`);
    assert.match(hit.meta, /^窗口( \d+)?$/, `摘要应以「窗口 N」开头，实际：${hit.meta}`);
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
    chrome.__state.windows = chrome.__state.windows.filter((w) => w !== big && w !== small && w !== popup);
  }
});

/* ============================ 批量关闭 ============================ */

test("关闭标签：一个陈旧 id 不会带走整批", async () => {
  await resetDb();
  const live = await chrome.tabs.create({ url: "https://close-me.test/1", active: false });
  const r = await actions.closeTabs([live.id, 999999]);
  assert.equal(r.closed, 1, "已存在的标签应被关掉");
  assert.deepEqual(r.failed, [], "已经不存在的标签不算失败");
  assert.equal(await chrome.tabs.get(live.id).catch(() => null), null);
});

test("关闭标签：Chrome 拒绝时要报告失败而不是静默", async () => {
  await resetDb();
  const victim = await chrome.tabs.create({ url: "https://refuse-me.test/1", active: false });
  const realRemove = chrome.tabs.remove;
  chrome.tabs.remove = async (ids) => {
    const list = Array.isArray(ids) ? ids : [ids];
    if (list.length > 1) throw new Error("No tab with id: 999999");
    if (list[0] === victim.id) throw new Error("Cannot close this tab");
    return realRemove.call(chrome, ids);
  };
  try {
    const r = await actions.closeTabs([victim.id, 999999]);
    assert.equal(r.closed, 0);
    assert.deepEqual(r.failed, [victim.id]);
    assert.ok(await chrome.tabs.get(victim.id), "被拒绝的标签应仍在");
  } finally {
    chrome.tabs.remove = realRemove;
  }
});

test("暂存并关闭：部分失败时如实报告关闭数量", async () => {
  await resetDb();
  const a = await chrome.tabs.create({ url: "https://stash-a.test/", active: false });
  const b = await chrome.tabs.create({ url: "https://stash-b.test/", active: false });
  const realRemove = chrome.tabs.remove;
  chrome.tabs.remove = async (ids) => {
    const list = Array.isArray(ids) ? ids : [ids];
    if (list.length > 1) throw new Error("No tab with id: 999999");
    if (list[0] === b.id) throw new Error("Cannot close this tab");
    return realRemove.call(chrome, ids);
  };
  try {
    const r = await collections.stashTabs([a, b], { close: true });
    assert.equal(r.closed, 1);
    assert.deepEqual(r.failed, [b.id]);
    assert.equal(collections.stashCollection().items.length, 2, "两个条目都应已入库");
  } finally {
    chrome.tabs.remove = realRemove;
  }
});

/* ============================ 闹钟与通知 ============================ */

test("闹钟：维护类定时器只在缺失时创建，重复调用不重置计时", async () => {
  await resetDb();
  await chrome.alarms.clearAll();
  await reminders.ensureHousekeepingAlarms();
  const flush = await chrome.alarms.get(reminders.ALARM_FLUSH);
  const housekeep = await chrome.alarms.get(reminders.ALARM_HOUSEKEEP);
  assert.ok(flush, "前台时长结算闹钟应存在");
  assert.equal(flush.periodInMinutes, 1);
  assert.ok(housekeep, "回收站 30 天清理闹钟应存在");
  assert.equal(housekeep.periodInMinutes, 720);
  await reminders.ensureHousekeepingAlarms();
  assert.equal((await chrome.alarms.get(reminders.ALARM_FLUSH)).scheduledTime, flush.scheduledTime, "重复调用不应重置计时");
});

test("备份：导入的提醒会重新挂上闹钟", async () => {
  await resetDb();
  const doc = {
    app: "tab-steward",
    format: 1,
    reminders: [
      { id: "rem_imported", url: "https://a.com/x", urlKey: "https://a.com/x", host: "a.com", site: "a.com", title: "X", scope: "page", fireAt: Date.now() + 600_000, status: "pending", createdAt: Date.now() },
    ],
  };
  const report = await backup.applyBackup(doc, { mode: "merge" });
  assert.ok(report.applied.includes("reminders"));
  assert.ok(await chrome.alarms.get("rem:rem_imported"), "导入的提醒必须有闹钟，否则永不触发");
});

test("提醒通知：使用桌面能显示的 priority，并保留操作按钮", async () => {
  await resetDb();
  const r = await reminders.createReminder({ url: "https://a.com/1", title: "A", offsetMinutes: 30 });
  await store.set("reminders", [{ ...r, fireAt: Date.now() - 1000 }]);
  await reminders.fireReminder(r.id);
  const n = chrome.__state.notifications.find((x) => x.id === `reminder-${r.id}`);
  assert.ok(n, "应发出系统通知");
  assert.ok(n.priority >= 0, "负 priority 在 Windows / Linux / macOS 上根本不会显示");
  assert.equal(n.requireInteraction, true, "带按钮的通知必须留在屏幕上");
  assert.equal(n.buttons.length, 2);
});

/* ============================ 功能模块 ============================ */

test("模块注册表：id 唯一、核心恒开、默认值与 settings 一致", async () => {
  const { MODULES, CORE_MODULE_IDS, defaultModules, isOn } = await import("../src/core/modules.js");
  const ids = MODULES.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, "模块 id 不能重复");
  const defs = defaultModules();
  assert.deepEqual(Object.keys(defs).slice().sort(), ids.slice().sort(), "每个模块都要有默认值");
  const { defaultSettings } = await import("../src/core/defaults.js");
  assert.deepEqual(defaultSettings().modules, defs, "defaultSettings().modules 必须来自注册表");
  for (const id of CORE_MODULE_IDS) {
    assert.equal(isOn({ modules: { [id]: false } }, id), true, "核心模块关不掉");
  }
  assert.ok(CORE_MODULE_IDS.includes("analytics"), "闲置度与全部排序都依赖这份采集，使用分析必须不可关");
  assert.equal(isOn({}, "llm"), false, "未落盘的设置按注册表默认值判定");
  assert.equal(isOn({}, "duplicates"), true);
});

test("模块注册表：每个可关模块都有真实消费者", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = dir + "/" + name;
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".js")) files.push(p);
    }
  })("src");
  const { MODULES, CORE_MODULE_IDS } = await import("../src/core/modules.js");
  for (const m of MODULES.filter((x) => !CORE_MODULE_IDS.includes(x.id))) {
    const consumers = files
      .filter((f) => !f.endsWith("core/modules.js"))
      .filter((f) => new RegExp(`["'\`]${m.id}["'\`]`).test(readFileSync(f, "utf8")));
    assert.ok(consumers.length, `「${m.label}」没有任何入口读取它的开关 —— 开关就是谎话`);
  }
});

test("模块：关闭提醒后闹钟被清掉，重新打开又挂回来", async () => {
  await resetDb();
  const r = await reminders.createReminder({ url: "https://a.com/1", title: "A", offsetMinutes: 30 });
  assert.ok(await chrome.alarms.get(`rem:${r.id}`), "开启时应有闹钟");
  await store.patch("settings", { modules: { reminders: false } });
  await reminders.syncAlarms();
  assert.equal(await chrome.alarms.get(`rem:${r.id}`), undefined, "关闭后不应留下闹钟");
  assert.equal(await chrome.action.getBadgeText(), "", "关闭后角标应清零");
  await store.patch("settings", { modules: { reminders: true } });
  await reminders.syncAlarms();
  assert.ok(await chrome.alarms.get(`rem:${r.id}`), "重新打开应恢复闹钟");
  assert.equal((store.get("reminders") || []).length, 1, "关闭模块不得删除数据");
});

test("通知：粘性开关决定通知是否留在屏幕上", async () => {
  await resetDb();
  const r = await reminders.createReminder({ url: "https://a.com/1", title: "A", offsetMinutes: 30 });
  await store.set("reminders", [{ ...r, fireAt: Date.now() - 1000 }]);
  await store.patch("settings", { notifications: { sticky: false } });
  await reminders.fireReminder(r.id);
  const n = chrome.__state.notifications.find((x) => x.id === `reminder-${r.id}`);
  assert.equal(n.requireInteraction, false, "关掉粘性后通知不再常驻");
});

test("模块：关闭休眠后自动休眠不再挑中任何标签", async () => {
  await resetDb();
  // earlier cases close the seeded tabs, so make a deliberately idle one
  const idle = await chrome.tabs.create({ url: "https://idle-sleep.test/x", title: "闲置页", active: false });
  chrome.__state.tabs.find((t) => t.id === idle.id).lastAccessed = Date.now() - 30 * 60_000;
  const sleep = await import("../src/background/sleep.js");
  const on = await sleep.planAutoSleep({ idleMinutes: 1 });
  assert.ok(on.enabled && on.candidates.some((c) => c.tab.id === idle.id), "开启时闲置标签应入选");
  await store.patch("settings", { modules: { sleep: false } });
  const off = await sleep.planAutoSleep({ idleMinutes: 1 });
  assert.equal(off.enabled, false);
  assert.equal(off.candidates.length, 0, "关闭后不得休眠任何标签");
});

test("service worker：整条静态导入闭包里不得有动态 import()", async () => {
  const { readFileSync, existsSync, readdirSync, statSync } = await import("node:fs");
  const { dirname, resolve, join } = await import("node:path");
  const roots = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".js")) roots.push(p);
    }
  })("src/background");

  const seen = new Set();
  const offenders = [];
  const queue = roots;
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const code = readFileSync(file, "utf8");
    for (const m of code.matchAll(/(?:await|return)\s+import\s*\(/g)) {
      offenders.push(`${file}:${code.slice(0, m.index).split("\n").length}`);
    }
    for (const m of code.matchAll(/from\s*["'](\.[^"']+)["']/g)) {
      const target = resolve(dirname(file), m[1]);
      if (existsSync(target)) queue.push(target);
      else offenders.push(`${file}: 无法解析的导入 ${m[1]}`);
    }
  }
  assert.ok(seen.size >= 12, `闭包只走了 ${seen.size} 个模块，遍历本身可能坏了`);
  assert.deepEqual(offenders, [], "ServiceWorkerGlobalScope 禁用 import()，闭包里任何一处都会在后台抛出 TypeError");
});

test("service worker：模块图可完整加载并挂上维护闹钟", async () => {
  await resetDb();
  // last one — importing the worker registers its listeners for good
  await import("../src/background/index.js");
  await new Promise((r) => setTimeout(r, 120));
  const names = (await chrome.alarms.getAll()).map((a) => a.name);
  assert.ok(names.includes(reminders.ALARM_FLUSH), "前台时长结算闹钟应在");
  assert.ok(names.includes(reminders.ALARM_HOUSEKEEP), "回收站清理闹钟应在");
  assert.ok(names.includes(reminders.ALARM_AUTOSLEEP), "自动休眠闹钟应在");
  // 菜单是 bootstrap 的最后一步：中途抛错只会往 console 打一行，闹钟却早就挂好了
  assert.ok(chrome.__state.menus.has("ts-root"), "右键菜单根节点应在");
  assert.ok(chrome.__state.menus.has("dashboard"), "菜单要建到最后一项，bootstrap 半路抛错这里就缺");
});

/* ================= 重复标签提示（service worker 监听已挂上） ================= */

const dupeNotifications = () => chrome.__state.notifications.filter((n) => n.id.startsWith("dupe-"));

/**
 * 造一对同网址标签：先建「已经开着的那个」（置为非活动），再让新副本走一遍后台的
 * onUpdated 监听。网址逐次递增，用例之间不会互相认领成重复。
 */
let dupeSeq = 0;
async function openDuplicateTab() {
  await dupes.suppressFor(0); // 前面用例留下的批量操作静默窗口会让提示被跳过，先清掉
  const url = `https://dup.example/page-${++dupeSeq}`;
  const existing = await chrome.tabs.create({ url, title: "已有页面" });
  await chrome.tabs.update(existing.id, { active: false });
  const copy = await chrome.tabs.create({ url, title: "重复副本" });
  chrome.tabs.onUpdated.fire(copy.id, { url, status: "complete" }, { ...copy });
  await new Promise((r) => setTimeout(r, 60));
  return { existing, copy };
}

test("重复标签：发现重复只提示，不替用户关掉任何标签", async () => {
  await resetDb();
  const removed = chrome.__state.removedTabs.length;
  const { copy } = await openDuplicateTab();
  assert.equal(chrome.__state.removedTabs.length, removed, "检测到重复就关标签是本模块的越权");
  assert.ok(chrome.__state.tabs.some((t) => t.id === copy.id), "新开的副本要原样留着");
  const n = dupeNotifications()[0];
  assert.ok(n, "应有一条重复提示");
  assert.equal(n.title, "发现重复标签");
  assert.deepEqual(n.buttons.map((b) => b.title), ["关闭这个并跳转", "切换到已有标签"]);
});

test("重复标签：提示里点「关闭这个并跳转」才关闭，并把焦点交给已有标签", async () => {
  await resetDb();
  const { existing, copy } = await openDuplicateTab();
  chrome.notifications.onButtonClicked.fire(dupeNotifications()[0].id, 0);
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(chrome.__state.removedTabs.some((t) => t.id === copy.id), "用户选了关闭，副本才关");
  assert.equal(chrome.__state.tabs.find((t) => t.id === existing.id).active, true, "应跳到已打开的那个");
  assert.equal(dupeNotifications().length, 0, "处理完通知要收起");
});

test("重复标签：点「切换到已有标签」两个都保留", async () => {
  await resetDb();
  const removed = chrome.__state.removedTabs.length;
  const { existing, copy } = await openDuplicateTab();
  chrome.notifications.onButtonClicked.fire(dupeNotifications()[0].id, 1);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(chrome.__state.removedTabs.length, removed, "只跳转不该关标签");
  assert.ok(chrome.__state.tabs.some((t) => t.id === copy.id), "两个标签都要还在");
  assert.equal(chrome.__state.tabs.find((t) => t.id === existing.id).active, true, "应跳到已打开的那个");
});

test("重复标签：关掉提示开关后既不打扰也不动手", async () => {
  await resetDb();
  const removed = chrome.__state.removedTabs.length;
  await store.patch("settings", { duplicateWarning: false });
  await openDuplicateTab();
  assert.equal(dupeNotifications().length, 0, "关了提示就一条都不该有");
  assert.equal(chrome.__state.removedTabs.length, removed);
});

test("重复标签：关闭模块后后台停止检测重复", async () => {
  await resetDb();
  const removed = chrome.__state.removedTabs.length;
  await store.patch("settings", { modules: { duplicates: false } });
  await openDuplicateTab();
  assert.equal(dupeNotifications().length, 0, "模块关掉后不该再发通知");
  assert.equal(chrome.__state.removedTabs.length, removed);
});

/* ------------------------------------------------------------------ */

let passed = 0;
const failures = [];
for (const { name, fn } of tests) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}\n       ${String(err.message).split("\n").join("\n       ")}`);
  }
}

console.log(`\n${passed}/${tests.length} passed`);
if (failures.length) {
  console.log(`\n失败 ${failures.length} 项：`);
  for (const f of failures) console.log(` - ${f.name}: ${f.err.message}`);
  process.exit(1);
}
