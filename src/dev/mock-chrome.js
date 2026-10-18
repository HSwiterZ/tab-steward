/**
 * Development harness: a chrome.* shim backed by localStorage with a seeded
 * browser state, so every surface (popup / dashboard / newtab / options)
 * can be opened in a normal tab and verified visually without loading the
 * extension. Never imported when the real chrome.tabs exists — see dev/boot.js.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.now();

globalThis.__MOCK_CHROME__ = true;

/* ------------------------------------------------------------------ *
 * tiny event registry
 * ------------------------------------------------------------------ */
function EventTarget_() {
  const listeners = new Set();
  return {
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    hasListener: (fn) => listeners.has(fn),
    hasListeners: () => listeners.size > 0,
    _fire: (...args) => {
      for (const fn of [...listeners]) {
        try {
          fn(...args);
        } catch (err) {
          console.error("[mock] listener error", err);
        }
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 * seed data
 * ------------------------------------------------------------------ */
const SITES = [
  { host: "github.com", title: "chrome-tabs-manager · 仓库", path: "/qoder/chrome-tabs-manager" },
  { host: "github.com", title: "Pull Request #482: 重构休眠调度", path: "/qoder/chrome-tabs-manager/pull/482" },
  { host: "github.com", title: "Issues · 标签分组丢失", path: "/qoder/chrome-tabs-manager/issues/91" },
  { host: "stackoverflow.com", title: "javascript - chrome.tabs.discard 不释放内存", path: "/questions/7712345" },
  { host: "stackoverflow.com", title: "Manifest V3 service worker 生命周期", path: "/questions/7123498" },
  { host: "news.ycombinator.com", title: "Hacker News", path: "/news" },
  { host: "news.ycombinator.com", title: "Show HN: 我把 300 个标签整理成了一张地图", path: "/item?id=40221" },
  { host: "developer.mozilla.org", title: "chrome.tabGroups - Mozilla Docs", path: "/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabGroups" },
  { host: "developer.mozilla.org", title: "IndexedDB 使用指南", path: "/en-US/docs/Web/API/IndexedDB_API" },
  { host: "docs.google.com", title: "标签管理器 - 需求评审", path: "/document/d/1aB2cD3" },
  { host: "youtube.com", title: "Building a Chrome Extension in 2026", path: "/watch?v=dQw4w9WgXcQ" },
  { host: "npmjs.com", title: "vite", path: "/package/vite" },
  { host: "localhost:5173", title: "Dashboard · 本地预览", path: "/" },
  { host: "ui.shadcn.com", title: "Components", path: "/docs/components" },
  { host: "zhihu.com", title: "如何优雅地管理上百个浏览器标签？", path: "/question/19550" },
  { host: "juejin.cn", title: "MV3 迁移踩坑记录", path: "/post/7211" },
  { host: "arxiv.org", title: "Attention Is All You Need", path: "/abs/1706.03762" },
  { host: "tailwindcss.com", title: "Documentation", path: "/docs/installation" },
  { host: "example-shop.com", title: "机械键盘 · 购物车", path: "/cart" },
  { host: "example-shop.com", title: "订单 #88213", path: "/orders/88213" },
];

const url = (s) => `https://${s.host}${s.path}`;

let nextTabId = 100;
const tabs = [];
const groups = [
  { id: 1, title: "研究资料", color: "blue", windowId: 2 },
  { id: 2, title: "购物", color: "orange", windowId: 2 },
  { id: 3, title: "开发", color: "green", windowId: 1 },
];

const windows = [
  { id: 1, type: "normal", focused: true, state: "normal", left: 0, top: 0, width: 1440, height: 900, incognito: false, alwaysOnTop: false },
  { id: 2, type: "normal", focused: false, state: "normal", left: 80, top: 60, width: 1360, height: 860, incognito: false, alwaysOnTop: false },
  { id: 3, type: "popup", focused: false, state: "normal", left: 200, top: 200, width: 620, height: 700, incognito: false, alwaysOnTop: false },
];

function mkTab(siteIdx, windowId, extra = {}) {
  const s = SITES[siteIdx % SITES.length];
  const id = nextTabId++;
  const tab = {
    id,
    index: tabs.filter((t) => t.windowId === windowId).length,
    windowId,
    url: url(s),
    title: s.title,
    favIconUrl: "",
    status: "complete",
    active: false,
    highlighted: false,
    pinned: false,
    audible: false,
    mutedInfo: { muted: false },
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    openerTabId: undefined,
    lastAccessed: T0 - Math.floor(Math.random() * 3 * DAY),
    _site: s.host,
    ...extra,
  };
  tabs.push(tab);
  return tab;
}

// window 1 — development work
mkTab(0, 1, { active: true, highlighted: true, lastAccessed: T0 - 40_000 });
mkTab(1, 1, { groupId: 3, lastAccessed: T0 - 6 * HOUR });
mkTab(2, 1, { groupId: 3, lastAccessed: T0 - 26 * HOUR });
mkTab(3, 1, { lastAccessed: T0 - 2 * HOUR });
mkTab(7, 1, { lastAccessed: T0 - 5 * MIN });
mkTab(12, 1, { lastAccessed: T0 - 90_000 });
mkTab(13, 1, { pinned: true, lastAccessed: T0 - 20 * MIN });
mkTab(5, 1, { lastAccessed: T0 - 3 * DAY });
mkTab(10, 1, { audible: true, lastAccessed: T0 - 11 * MIN });
mkTab(11, 1, { lastAccessed: T0 - 4 * DAY, discarded: true });

// window 2 — reading, with two tab groups
mkTab(6, 2, { active: true, highlighted: true, lastAccessed: T0 - 30 * MIN });
mkTab(8, 2, { groupId: 1, lastAccessed: T0 - 7 * HOUR });
mkTab(16, 2, { groupId: 1, lastAccessed: T0 - 9 * HOUR });
mkTab(14, 2, { groupId: 1, lastAccessed: T0 - 2 * DAY });
mkTab(18, 2, { groupId: 2, lastAccessed: T0 - 40 * MIN });
mkTab(19, 2, { groupId: 2, lastAccessed: T0 - 55 * MIN });
mkTab(9, 2, { lastAccessed: T0 - 5 * DAY, discarded: true });
mkTab(15, 2, { lastAccessed: T0 - 3 * HOUR });
mkTab(17, 2, { lastAccessed: T0 - 8 * DAY, discarded: true });

// window 3 — popup window
mkTab(4, 3, { active: true, highlighted: true, lastAccessed: T0 - 15 * MIN });
mkTab(5, 3, { lastAccessed: T0 - 16 * MIN });
// deliberate duplicate of window 1's Hacker News front page
tabs.push({ ...tabs.find((t) => t._site === "news.ycombinator.com" && t.url.endsWith("/news")), id: nextTabId++, index: 2, windowId: 3, active: false, highlighted: false, lastAccessed: T0 - 2 * HOUR });

function reindex(windowId) {
  tabs.filter((t) => t.windowId === windowId).forEach((t, i) => (t.index = i));
}
windows.forEach((w) => reindex(w.id));

const bookmarks = {
  id: "0",
  title: "",
  children: [
    {
      id: "1",
      title: "书签栏",
      parentId: "0",
      children: [
        { id: "11", title: "GitHub", url: "https://github.com", parentId: "1" },
        { id: "12", title: "Hacker News", url: "https://news.ycombinator.com", parentId: "1" },
        {
          id: "13",
          title: "前端",
          parentId: "1",
          children: [
            { id: "131", title: "MDN", url: "https://developer.mozilla.org", parentId: "13" },
            { id: "132", title: "shadcn/ui", url: "https://ui.shadcn.com/docs/components", parentId: "13" },
            { id: "133", title: "Tailwind CSS", url: "https://tailwindcss.com/docs", parentId: "13" },
          ],
        },
        {
          id: "14",
          title: "稍后读",
          parentId: "1",
          children: [{ id: "141", title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762", parentId: "14" }],
        },
      ],
    },
    { id: "2", title: "其他书签", parentId: "0", children: [{ id: "21", title: "掘金", url: "https://juejin.cn", parentId: "2" }] },
  ],
};

const HISTORY_SITES = [
  "chrome-extension 内部页",
  ...SITES.map((s) => s.title),
  "Rust 程序设计语言",
  "如何写一个好的 Chrome 扩展",
  "Web Worker 与 Service Worker 的区别",
  "标签页内存占用实测",
];

const history = [];
for (let i = 0; i < 60; i++) {
  const s = SITES[i % SITES.length];
  history.push({
    id: `h${i}`,
    url: i % 7 === 0 ? `https://${s.host}/article/${i}` : url(s),
    title: i % 7 === 0 ? HISTORY_SITES[i % HISTORY_SITES.length] : s.title,
    lastVisitTime: T0 - i * 3.7 * HOUR - Math.random() * HOUR,
    visitCount: 1 + Math.floor(Math.random() * 24),
    typedCount: Math.floor(Math.random() * 6),
  });
}

const sessions = [
  { tab: { sessionId: "s1", url: "https://news.ycombinator.com/item?id=39999", title: "已关闭：一场关于标签管理的讨论", lastAccessed: T0 - 25 * MIN } },
  { tab: { sessionId: "s2", url: "https://github.com/qoder/chrome-tabs-manager/commit/9f2c", title: "已关闭：commit 9f2c", lastAccessed: T0 - 2 * HOUR } },
  { tab: { sessionId: "s3", url: "https://example-shop.com/item/keyboard", title: "已关闭：机械键盘详情", lastAccessed: T0 - 5 * HOUR } },
  { window: { sessionId: "s4", tabs: [{ url: "https://arxiv.org/abs/1706.03762", title: "Attention" }], lastModified: T0 - 9 * HOUR } },
  { tab: { sessionId: "s5", url: "https://zhihu.com/question/19550/answer/1", title: "已关闭：知乎回答", lastAccessed: T0 - 1 * DAY } },
];

/* ------------------------------------------------------------------ *
 * storage.local backed by localStorage
 * ------------------------------------------------------------------ */
const STORAGE_PREFIX = "__mock_chrome__:";
const storageChanged = EventTarget_();

function readAll() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k.startsWith(STORAGE_PREFIX)) continue;
    try {
      out[k.slice(STORAGE_PREFIX.length)] = JSON.parse(localStorage.getItem(k));
    } catch {
      /* ignore corrupt entries */
    }
  }
  return out;
}

function normalizeKeys(keys) {
  if (keys == null) return null;
  if (typeof keys === "string") return [keys];
  if (Array.isArray(keys)) return keys;
  return Object.keys(keys);
}

const storageArea = (areaName) => ({
  async get(keys = null) {
    const all = readAll();
    const wanted = normalizeKeys(keys);
    const out = {};
    if (!wanted) return all;
    for (const k of wanted) if (k in all) out[k] = all[k];
    if (!Array.isArray(keys) && typeof keys === "object" && keys) for (const [k, v] of Object.entries(keys)) if (!(k in out)) out[k] = v;
    return out;
  },
  async set(items) {
    const changes = {};
    for (const [k, v] of Object.entries(items)) {
      const raw = localStorage.getItem(STORAGE_PREFIX + k);
      changes[k] = { oldValue: raw ? JSON.parse(raw) : undefined, newValue: v };
      localStorage.setItem(STORAGE_PREFIX + k, JSON.stringify(v));
    }
    setTimeout(() => storageChanged._fire(changes, areaName), 0);
  },
  async remove(keys) {
    const changes = {};
    for (const k of normalizeKeys(keys) || []) {
      const raw = localStorage.getItem(STORAGE_PREFIX + k);
      changes[k] = { oldValue: raw ? JSON.parse(raw) : undefined };
      localStorage.removeItem(STORAGE_PREFIX + k);
    }
    setTimeout(() => storageChanged._fire(changes, areaName), 0);
  },
  async clear() {
    for (const k of Object.keys(readAll())) localStorage.removeItem(STORAGE_PREFIX + k);
  },
  async getBytesInUse() {
    return JSON.stringify(readAll()).length;
  },
});

/* ------------------------------------------------------------------ *
 * messaging: pages talk to an in-page copy of the service worker
 * ------------------------------------------------------------------ */
const runtimeMessage = EventTarget_();
const runtimeConnect = EventTarget_();
const ports = [];

const messageListeners = [];
runtimeMessage.addListener = (fn) => {
  messageListeners.push(fn);
};
runtimeMessage.removeListener = (fn) => {
  const i = messageListeners.indexOf(fn);
  if (i > -1) messageListeners.splice(i, 1);
};
runtimeMessage.hasListener = (fn) => messageListeners.includes(fn);
runtimeMessage.hasListeners = () => messageListeners.length > 0;

function dispatchMessage(message, sender, sendResponse) {
  let responded = false;
  let async = false;
  const wrapped = (value) => {
    if (responded) return;
    responded = true;
    sendResponse(value);
  };
  for (const fn of messageListeners) {
    let result;
    try {
      result = fn(message, sender, wrapped);
    } catch (err) {
      console.error("[mock] onMessage listener threw", err);
      continue;
    }
    if (result && typeof result.then === "function") {
      async = true;
      result
        .then((v) => wrapped(v === undefined ? null : v))
        .catch((err) => {
          console.error("[mock] handler rejected", err);
          wrapped({ __error: String(err?.message || err) });
        });
    } else if (result === true) {
      async = true;
    }
  }
  return async;
}

/* ------------------------------------------------------------------ *
 * tabs / windows / tabGroups
 * ------------------------------------------------------------------ */
const tabEvents = {
  onUpdated: EventTarget_(),
  onRemoved: EventTarget_(),
  onCreated: EventTarget_(),
  onActivated: EventTarget_(),
  onMoved: EventTarget_(),
  onAttached: EventTarget_(),
  onDetached: EventTarget_(),
  onHighlighted: EventTarget_(),
  onZoomChange: EventTarget_(),
};
const winEvents = { onFocusChanged: EventTarget_(), onCreated: EventTarget_(), onRemoved: EventTarget_(), onBoundsChanged: EventTarget_() };
const groupEvents = { onCreated: EventTarget_(), onUpdated: EventTarget_(), onRemoved: EventTarget_(), onMoved: EventTarget_() };

const cloneTab = (t) => JSON.parse(JSON.stringify(t));
const matches = (tab, q = {}) =>
  (q.active === undefined || tab.active === q.active) &&
  (q.pinned === undefined || tab.pinned === q.pinned) &&
  (q.audible === undefined || tab.audible === q.audible) &&
  (q.discarded === undefined || tab.discarded === q.discarded) &&
  (q.windowId === undefined || tab.windowId === q.windowId) &&
  (q.groupId === undefined || tab.groupId === q.groupId) &&
  (q.currentWindow === undefined || q.currentWindow === false || tab.windowId === currentWindowId) &&
  (q.lastFocusedWindow === undefined || tab.windowId === currentWindowId) &&
  (q.url === undefined || matchUrlPattern(tab.url, q.url)) &&
  (q.title === undefined || tab.title.includes(q.title));

function matchUrlPattern(tabUrl, pattern) {
  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  return patterns.some((p) => {
    const re = new RegExp("^" + String(p).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
    return re.test(tabUrl);
  });
}

let currentWindowId = 1;

function asArray(v) {
  return Array.isArray(v) ? v : [v];
}

const tabsApi = {
  async query(q = {}) {
    return tabs.filter((t) => matches(t, q)).sort((a, b) => a.windowId - b.windowId || a.index - b.index).map(cloneTab);
  },
  async get(id) {
    const t = tabs.find((x) => x.id === id);
    if (!t) throw new Error(`No tab with id: ${id}`);
    return cloneTab(t);
  },
  async create(props = {}) {
    const windowId = props.windowId ?? currentWindowId;
    const win = windows.find((w) => w.id === windowId);
    const s = { host: "example.com", title: props.url || "新标签页", path: "" };
    const id = nextTabId++;
    const tab = {
      id,
      windowId,
      index: props.index ?? tabs.filter((t) => t.windowId === windowId).length,
      url: props.url ?? "chrome://newtab/",
      pendingUrl: props.url,
      title: props.url ? new URL(props.url).hostname : "新标签页",
      favIconUrl: "",
      status: "loading",
      active: props.active !== false,
      highlighted: props.active !== false,
      pinned: !!props.pinned,
      audible: false,
      mutedInfo: { muted: false },
      discarded: false,
      autoDiscardable: props.autoDiscardable !== false,
      groupId: props.groupId ?? -1,
      openerTabId: props.openerTabId,
      lastAccessed: Date.now(),
      _site: s.host,
    };
    if (tab.active) {
      tabs.filter((t) => t.windowId === windowId).forEach((t) => ((t.active = false), (t.highlighted = false)));
    }
    tabs.push(tab);
    reindex(windowId);
    tabEvents.onCreated._fire(cloneTab(tab));
    if (tab.active) tabEvents.onActivated._fire({ tabId: id, windowId });
    void win;
    setTimeout(() => {
      tab.status = "complete";
      tabEvents.onUpdated._fire(id, { status: "complete" }, cloneTab(tab));
    }, 60);
    return cloneTab(tab);
  },
  async update(id, props = {}) {
    const list = id == null ? tabs.filter((t) => t.windowId === currentWindowId && t.active) : asArray(id).map((x) => tabs.find((t) => t.id === x)).filter(Boolean);
    const out = [];
    for (const tab of list) {
      const changes = {};
      if (props.active !== undefined) {
        if (props.active) {
          tabs.filter((t) => t.windowId === tab.windowId).forEach((t) => ((t.active = false), (t.highlighted = false)));
          tab.active = true;
          tab.highlighted = true;
          tab.lastAccessed = Date.now();
          changes.active = true;
          tabEvents.onActivated._fire({ tabId: tab.id, windowId: tab.windowId });
        } else {
          tab.active = false;
          tab.highlighted = false;
          changes.active = false;
        }
      }
      if (props.pinned !== undefined && props.pinned !== tab.pinned) {
        tab.pinned = props.pinned;
        changes.pinned = props.pinned;
      }
      if (props.muted !== undefined) {
        tab.mutedInfo = { muted: props.muted };
        changes.mutedInfo = tab.mutedInfo;
      }
      if (props.url !== undefined) {
        tab.url = props.url;
        tab.status = "loading";
        changes.url = props.url;
        try {
          tab.title = new URL(props.url).hostname;
        } catch {
          /* keep title */
        }
        setTimeout(() => {
          tab.status = "complete";
          tabEvents.onUpdated._fire(tab.id, { status: "complete" }, cloneTab(tab));
        }, 60);
      }
      if (props.autoDiscardable !== undefined) tab.autoDiscardable = props.autoDiscardable;
      if (props.openerTabId !== undefined) tab.openerTabId = props.openerTabId;
      reindex(tab.windowId);
      tabEvents.onUpdated._fire(tab.id, changes, cloneTab(tab));
      out.push(cloneTab(tab));
    }
    return out.length === 1 && id != null && !Array.isArray(id) ? out[0] : out;
  },
  async move(id, props = {}) {
    const ids = asArray(id);
    const moved = [];
    for (const tid of ids) {
      const tab = tabs.find((t) => t.id === tid);
      if (!tab) continue;
      const fromWindow = tab.windowId;
      const toWindow = props.windowId ?? fromWindow;
      tab.windowId = toWindow;
      tabs.splice(tabs.indexOf(tab), 1);
      const siblings = tabs.filter((t) => t.windowId === toWindow).sort((a, b) => a.index - b.index);
      const at = props.index == null || props.index < 0 ? siblings.length : Math.min(props.index, siblings.length);
      const anchor = siblings[at];
      tabs.splice(anchor ? tabs.indexOf(anchor) : tabs.length, 0, tab);
      reindex(fromWindow);
      reindex(toWindow);
      tabEvents.onMoved._fire(tid, { windowId: toWindow, fromIndex: 0, toIndex: tab.index });
      if (fromWindow !== toWindow) {
        tabEvents.onDetached._fire(tid, { windowId: fromWindow, isWindowClosing: false });
        tabEvents.onAttached._fire(tid, { windowId: toWindow, tabPosition: tab.index });
      }
      moved.push(cloneTab(tab));
    }
    return moved.length === 1 && !Array.isArray(id) ? moved[0] : moved;
  },
  async remove(id) {
    for (const tid of asArray(id)) {
      const i = tabs.findIndex((t) => t.id === tid);
      if (i === -1) continue;
      const [tab] = tabs.splice(i, 1);
      sessions.unshift({ tab: { sessionId: `s${tid}`, url: tab.url, title: tab.title, lastAccessed: Date.now() } });
      reindex(tab.windowId);
      tabEvents.onRemoved._fire(tid, { windowId: tab.windowId, isWindowClosing: false });
    }
  },
  async reload(id) {
    for (const tid of id == null ? [] : asArray(id)) {
      const tab = tabs.find((t) => t.id === tid);
      if (!tab) continue;
      tab.discarded = false;
      tab.status = "loading";
      tabEvents.onUpdated._fire(tid, { status: "loading" }, cloneTab(tab));
      setTimeout(() => {
        tab.status = "complete";
        tabEvents.onUpdated._fire(tid, { status: "complete" }, cloneTab(tab));
      }, 80);
    }
  },
  async duplicate(id) {
    const src = tabs.find((t) => t.id === id);
    if (!src) return;
    return tabsApi.create({ url: src.url, windowId: src.windowId, index: src.index + 1 });
  },
  async discard(id) {
    for (const tid of asArray(id)) {
      const tab = tabs.find((t) => t.id === tid);
      if (!tab || tab.active) continue;
      tab.discarded = true;
      tabEvents.onUpdated._fire(tid, { discarded: true }, cloneTab(tab));
    }
    return true;
  },
  async group(props) {
    const ids = asArray(props.tabIds);
    let gid = props.groupId;
    if (gid == null || gid === -1) {
      gid = Math.max(0, ...groups.map((g) => g.id)) + 1;
      const first = tabs.find((t) => t.id === ids[0]);
      groups.push({ id: gid, title: "", color: "grey", windowId: first?.windowId ?? currentWindowId });
      groupEvents.onCreated._fire(gid);
    }
    for (const tid of ids) {
      const tab = tabs.find((t) => t.id === tid);
      if (tab) {
        tab.groupId = gid;
        tabEvents.onUpdated._fire(tid, { groupId: gid }, cloneTab(tab));
      }
    }
    return gid;
  },
  async ungroup(id) {
    for (const tid of asArray(id)) {
      const tab = tabs.find((t) => t.id === tid);
      if (!tab) continue;
      const gid = tab.groupId;
      tab.groupId = -1;
      tabEvents.onUpdated._fire(tid, { groupId: -1 }, cloneTab(tab));
      if (gid > -1 && !tabs.some((t) => t.groupId === gid)) {
        const gi = groups.findIndex((g) => g.id === gid);
        if (gi > -1) groups.splice(gi, 1);
        groupEvents.onRemoved._fire(gid, { windowId: tab.windowId, isWindowClosing: false });
      }
    }
  },
  async highlight(props) {
    const windowId = props.windowId ?? currentWindowId;
    tabs.filter((t) => t.windowId === windowId).forEach((t) => ((t.highlighted = false), (t.active = false)));
    for (const idx of asArray(props.tabs)) {
      const t = tabs.filter((x) => x.windowId === windowId).sort((a, b) => a.index - b.index)[idx];
      if (t) t.highlighted = true;
    }
    const win = windows.find((w) => w.id === windowId);
    return { ...win, tabs: tabs.filter((t) => t.windowId === windowId).map(cloneTab) };
  },
  async captureVisibleTab() {
    return MOCK_SCREENSHOT;
  },
  async detectLanguage() {
    return { languages: [{ language: "zh-CN", percentage: 100 }] };
  },
  ...tabEvents,
};

/* A tiny inline SVG "screenshot" so the hover-preview feature is visible offline. */
const MOCK_SCREENSHOT =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300"><rect width="480" height="300" fill="#f4f4f5"/><rect width="480" height="34" fill="#e4e4e7"/><circle cx="18" cy="17" r="5" fill="#a1a1aa"/><rect x="34" y="10" width="180" height="14" rx="7" fill="#fff"/><rect x="24" y="54" width="200" height="16" rx="4" fill="#d4d4d8"/><rect x="24" y="84" width="432" height="9" rx="4" fill="#e4e4e7"/><rect x="24" y="102" width="390" height="9" rx="4" fill="#e4e4e7"/><rect x="24" y="120" width="410" height="9" rx="4" fill="#e4e4e7"/><rect x="24" y="156" width="200" height="120" rx="8" fill="#fff" stroke="#e4e4e7"/><rect x="240" y="156" width="216" height="120" rx="8" fill="#fff" stroke="#e4e4e7"/></svg>`
  );

const windowsApi = {
  async getAll(info = {}) {
    return windows.map((w) => {
      const win = { ...w };
      if (info.populate) win.tabs = tabs.filter((t) => t.windowId === w.id).sort((a, b) => a.index - b.index).map(cloneTab);
      if (info.windowTypes) void info.windowTypes;
      return win;
    });
  },
  async get(id, info = {}) {
    const w = windows.find((x) => x.id === id || (id === -2 && x.focused));
    if (!w) throw new Error(`No window with id: ${id}`);
    const win = { ...w };
    if (info.populate) win.tabs = tabs.filter((t) => t.windowId === w.id).sort((a, b) => a.index - b.index).map(cloneTab);
    return win;
  },
  async getCurrent(info = {}) {
    return windowsApi.get(currentWindowId, info);
  },
  async getLastFocused(info = {}) {
    return windowsApi.get(windows.find((w) => w.focused)?.id ?? currentWindowId, info);
  },
  async create(props = {}) {
    const id = Math.max(...windows.map((w) => w.id)) + 1;
    const win = {
      id,
      type: props.type || "normal",
      focused: props.focused !== false,
      state: props.state || "normal",
      left: props.left ?? 100,
      top: props.top ?? 100,
      width: props.width ?? 1200,
      height: props.height ?? 800,
      incognito: false,
      alwaysOnTop: false,
    };
    windows.forEach((w) => (w.focused = false));
    windows.push(win);
    currentWindowId = id;
    if (props.url) {
      for (const u of asArray(props.url)) await tabsApi.create({ url: u, windowId: id });
    } else if (props.tabId) {
      for (const tid of asArray(props.tabId)) {
        const t = tabs.find((x) => x.id === tid);
        if (t) {
          t.windowId = id;
          reindex(win.id);
        }
      }
    } else {
      await tabsApi.create({ url: "chrome://newtab/", windowId: id });
    }
    winEvents.onCreated._fire({ ...win });
    winEvents.onFocusChanged._fire(id);
    return { ...win, tabs: tabs.filter((t) => t.windowId === id).map(cloneTab) };
  },
  async update(id, props = {}) {
    for (const wid of asArray(id ?? currentWindowId)) {
      const w = windows.find((x) => x.id === wid);
      if (!w) continue;
      Object.assign(w, props);
      if (props.focused === true) {
        windows.forEach((x) => (x.focused = x.id === wid));
        currentWindowId = wid;
        winEvents.onFocusChanged._fire(wid);
      }
      winEvents.onBoundsChanged._fire({ ...w });
    }
    return windowsApi.get(asArray(id)[0] ?? currentWindowId);
  },
  async remove(id) {
    for (const wid of asArray(id)) {
      const i = windows.findIndex((w) => w.id === wid);
      if (i === -1) continue;
      for (const t of tabs.filter((x) => x.windowId === wid)) tabEvents.onRemoved._fire(t.id, { windowId: wid, isWindowClosing: true });
      for (let j = tabs.length - 1; j >= 0; j--) if (tabs[j].windowId === wid) tabs.splice(j, 1);
      windows.splice(i, 1);
      winEvents.onRemoved._fire(wid);
    }
  },
  ...winEvents,
};

const tabGroupsApi = {
  async query(q = {}) {
    return groups
      .filter((g) => (q.windowId === undefined || g.windowId === q.windowId) && (q.title === undefined || g.title === q.title))
      .map((g) => ({ ...g, collapsed: !!g.collapsed }));
  },
  async get(id) {
    const g = groups.find((x) => x.id === id);
    if (!g) throw new Error(`No group with id: ${id}`);
    return { ...g };
  },
  async update(id, props = {}) {
    const g = groups.find((x) => x.id === id);
    if (!g) return;
    Object.assign(g, props);
    groupEvents.onUpdated._fire(id, { ...g });
    return { ...g };
  },
  async move(id, props = {}) {
    void id;
    void props;
    return groups[0];
  },
  ...groupEvents,
  TAB_GROUP_ID_NONE: -1,
};

/* ------------------------------------------------------------------ *
 * bookmarks / history / sessions
 * ------------------------------------------------------------------ */
function findNode(id, node = bookmarks) {
  if (node.id === id) return node;
  for (const c of node.children || []) {
    const hit = findNode(id, c);
    if (hit) return hit;
  }
  return null;
}
function findParent(id, node = bookmarks, parent = null) {
  if (node.id === id) return parent;
  for (const c of node.children || []) {
    const hit = findParent(id, c, node);
    if (hit) return hit;
  }
  return null;
}
let nextBmId = 1000;
const bookmarkEvents = { onCreated: EventTarget_(), onRemoved: EventTarget_(), onChanged: EventTarget_(), onMoved: EventTarget_() };

const bookmarksApi = {
  async getTree() {
    return [JSON.parse(JSON.stringify(bookmarks))];
  },
  async getSubTree(id) {
    const n = findNode(id);
    return n ? [JSON.parse(JSON.stringify(n))] : [];
  },
  async get(ids) {
    return asArray(ids).map((id) => findNode(String(id))).filter(Boolean).map((n) => JSON.parse(JSON.stringify(n)));
  },
  async search(q) {
    const out = [];
    const walk = (n) => {
      if (n.url && (n.title.includes(q) || n.url.includes(q))) out.push({ ...n });
      (n.children || []).forEach(walk);
    };
    walk(bookmarks);
    return out.slice(0, 100);
  },
  async getChildren(id) {
    const n = findNode(id);
    return (n?.children || []).map((c) => JSON.parse(JSON.stringify(c)));
  },
  async getRecent() {
    return [];
  },
  async create(bm = {}) {
    const parent = findNode(String(bm.parentId || "1")) || bookmarks.children[0];
    const node = {
      id: String(nextBmId++),
      parentId: parent.id,
      title: bm.title || "",
      url: bm.url,
      index: bm.index ?? (parent.children || []).length,
      dateAdded: Date.now(),
    };
    if (!bm.url) node.children = [];
    parent.children = parent.children || [];
    parent.children.push(node);
    bookmarkEvents.onCreated._fire(node.id, { ...node });
    return { ...node };
  },
  async update(id, props = {}) {
    const n = findNode(String(id));
    if (!n) return;
    if (props.title !== undefined) n.title = props.title;
    if (props.url !== undefined) n.url = props.url;
    bookmarkEvents.onChanged._fire(String(id), { title: n.title, url: n.url });
    return { ...n };
  },
  async move(id, props = {}) {
    const n = findNode(String(id));
    if (!n) return;
    const oldParent = findParent(String(id));
    const newParent = props.parentId ? findNode(String(props.parentId)) : oldParent;
    if (!newParent) return;
    oldParent.children = oldParent.children.filter((c) => c.id !== n.id);
    newParent.children = newParent.children || [];
    const at = props.index ?? newParent.children.length;
    newParent.children.splice(at, 0, n);
    n.parentId = newParent.id;
    bookmarkEvents.onMoved._fire(String(id), { parentId: newParent.id, oldParentId: oldParent?.id, index: at, oldIndex: 0 });
    return { ...n };
  },
  async remove(id) {
    const parent = findParent(String(id));
    if (!parent) throw new Error("Can't modify protected node");
    const n = findNode(String(id));
    if (n?.children) throw new Error("Can't remove non-empty folder");
    parent.children = parent.children.filter((c) => c.id !== String(id));
    bookmarkEvents.onRemoved._fire(String(id), { parentId: parent.id, node: n, isFolder: false });
  },
  async removeTree(id) {
    const parent = findParent(String(id));
    if (!parent) throw new Error("Can't modify protected node");
    const n = findNode(String(id));
    parent.children = parent.children.filter((c) => c.id !== String(id));
    bookmarkEvents.onRemoved._fire(String(id), { parentId: parent.id, node: n, isFolder: true });
  },
  ...bookmarkEvents,
};

const historyEvents = { onVisited: EventTarget_(), onVisitRemoved: EventTarget_() };
const historyApi = {
  async search(q) {
    const query = typeof q === "string" ? { text: q } : q || {};
    const text = (query.text || "").toLowerCase();
    const startTime = query.startTime || 0;
    const endTime = query.endTime || Date.now();
    const max = query.maxResults || 100;
    return history
      .filter((e) => (!text || e.title.toLowerCase().includes(text) || e.url.toLowerCase().includes(text)) && e.lastVisitTime >= startTime && e.lastVisitTime <= endTime)
      .sort((a, b) => b.lastVisitTime - a.lastVisitTime)
      .slice(0, max)
      .map((e) => ({ ...e }));
  },
  async getVisits(details) {
    const e = history.find((x) => x.url === details.url);
    return e ? [{ id: e.id, visitTime: e.lastVisitTime, transition: "link" }] : [];
  },
  async deleteUrl(details) {
    const i = history.findIndex((x) => x.url === details.url);
    if (i > -1) history.splice(i, 1);
  },
  async deleteRange(range) {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].lastVisitTime >= range.startTime && history[i].lastVisitTime < range.endTime) history.splice(i, 1);
    }
  },
  async deleteAll() {
    history.length = 0;
  },
  ...historyEvents,
};

const sessionEvents = { onChanged: EventTarget_() };
const sessionsApi = {
  async getRecentlyClosed(filter = {}) {
    return sessions.slice(0, filter.maxResults || 25).map((s) => JSON.parse(JSON.stringify(s)));
  },
  async getDevices() {
    return [];
  },
  async restore(sessionId) {
    const i = sessions.findIndex((s) => (s.tab?.sessionId || s.window?.sessionId) === sessionId);
    if (i === -1) return null;
    const [s] = sessions.splice(i, 1);
    if (s.tab) {
      const tab = await tabsApi.create({ url: s.tab.url, windowId: currentWindowId });
      tab.title = s.tab.title;
      return { tab };
    }
    const win = await windowsApi.create({ url: s.window.tabs.map((t) => t.url) });
    return { window: win };
  },
  ...sessionEvents,
};

/* ------------------------------------------------------------------ *
 * notifications / alarms / action / commands / contextMenus / misc
 * ------------------------------------------------------------------ */
const notifications = new Map();
const notificationEvents = { onClosed: EventTarget_(), onClicked: EventTarget_(), onButtonClicked: EventTarget_() };
const notificationsApi = {
  async create(id, options) {
    const nid = id || `n_${Math.random().toString(36).slice(2)}`;
    notifications.set(nid, options);
    console.info(`[mock notification] ${options.title} — ${options.message}`);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification(options.title, { body: options.message });
      } catch {
        /* ignore */
      }
    }
    return nid;
  },
  async clear(id) {
    const had = notifications.delete(id);
    notificationEvents.onClosed._fire(id, false);
    return had;
  },
  async getAll() {
    return [...notifications.keys()];
  },
  async getPermissionLevel() {
    return "granted";
  },
  ...notificationEvents,
};

const alarms = new Map();
const alarmEvents = { onAlarm: EventTarget_() };
const alarmsApi = {
  create(name, info) {
    const at = info.when ?? (info.delayInMinutes != null ? Date.now() + info.delayInMinutes * MIN : Date.now() + 60_000);
    const existing = alarms.get(name);
    if (existing) clearTimeout(existing.timer);
    const rec = { name, scheduledTime: at, periodInMinutes: info.periodInMinutes };
    const fire = () => {
      alarmEvents.onAlarm._fire({ ...rec });
      if (rec.periodInMinutes) {
        rec.scheduledTime = Date.now() + rec.periodInMinutes * MIN;
        rec.timer = setTimeout(fire, rec.periodInMinutes * MIN);
      } else alarms.delete(name);
    };
    rec.timer = setTimeout(fire, Math.max(0, at - Date.now()));
    alarms.set(name, rec);
  },
  async get(name) {
    const a = alarms.get(name);
    return a ? { name: a.name, scheduledTime: a.scheduledTime, periodInMinutes: a.periodInMinutes } : undefined;
  },
  async getAll() {
    return [...alarms.values()].map((a) => ({ name: a.name, scheduledTime: a.scheduledTime, periodInMinutes: a.periodInMinutes }));
  },
  async clear(name) {
    const a = alarms.get(name);
    if (a) clearTimeout(a.timer);
    return alarms.delete(name);
  },
  async clearAll() {
    for (const a of alarms.values()) clearTimeout(a.timer);
    alarms.clear();
    return true;
  },
  ...alarmEvents,
};

let badgeText = "";
const actionEvents = { onClicked: EventTarget_() };
const actionApi = {
  async setBadgeText(details) {
    badgeText = details.text || "";
    const el = document.getElementById("mock-badge");
    if (el) el.textContent = badgeText ? `角标: ${badgeText}` : "";
  },
  async getBadgeText() {
    return badgeText;
  },
  async setBadgeBackgroundColor() {},
  async setIcon() {},
  async setTitle(details) {
    document.title = details.title || document.title;
  },
  async getTitle() {
    return document.title;
  },
  async setPopup() {},
  async open() {},
  ...actionEvents,
};

const commandEvents = { onCommand: EventTarget_() };
const contextMenusApi = {
  create(props) {
    return props.id;
  },
  async removeAll() {},
  async update() {},
  async remove() {},
  onClicked: EventTarget_(),
};

const scriptingApi = {
  async executeScript() {
    return [{ result: null, frameId: 0 }];
  },
  async insertCSS() {
    return [];
  },
};

/* ------------------------------------------------------------------ *
 * assemble
 * ------------------------------------------------------------------ */
const runtime = {
  id: "mockextensionid000000000000000000",
  lastError: undefined,
  getURL: (p) => {
    // Under the dev server, extension assets live at the site root.
    const clean = String(p).replace(/^\//, "");
    if (globalThis.location?.origin && location.protocol.startsWith("http")) return `${location.origin}/${clean}`;
    return `mock-extension://${clean}`;
  },
  getManifest: () => ({ version: "1.0.0-mock", name: "Tab Steward (mock)" }),
  sendMessage: (message, _opts) =>
    new Promise((resolve, reject) => {
      const respond = (value) => {
        if (value && typeof value === "object" && value.__error) reject(new Error(value.__error));
        else resolve(value);
      };
      const isAsync = dispatchMessage(message, { id: runtime.id, url: location.href, tab: { id: 0 } }, respond);
      if (!isAsync) respond(undefined);
    }),
  onMessage: runtimeMessage,
  onMessageExternal: EventTarget_(),
  onConnect: runtimeConnect,
  onConnectExternal: EventTarget_(),
  /* Fires as soon as the background registers a listener, so install-time
     seeding runs the same way it does in a real profile. */
  onInstalled: (() => {
    const ev = EventTarget_();
    const original = ev.addListener;
    ev.addListener = (fn) => {
      original(fn);
      setTimeout(() => fn({ reason: "install", previousVersion: undefined }), 0);
    };
    return ev;
  })(),
  onStartup: EventTarget_(),
  onSuspend: EventTarget_(),
  reload: () => location.reload(),
  requestUpdateCheck: async () => ["no_update"],
  sendMessageExternal: async () => {},
  getPlatformInfo: async () => ({ os: "win", arch: "x86-64", nacl_arch: "x86-64" }),
};

globalThis.chrome = {
  runtime,
  storage: {
    local: storageArea("local"),
    sync: storageArea("sync"),
    session: storageArea("session"),
    managed: storageArea("managed"),
    onChanged: storageChanged,
  },
  tabs: tabsApi,
  windows: windowsApi,
  tabGroups: tabGroupsApi,
  bookmarks: bookmarksApi,
  history: historyApi,
  sessions: sessionsApi,
  notifications: notificationsApi,
  alarms: alarmsApi,
  action: actionApi,
  commands: commandEvents,
  contextMenus: contextMenusApi,
  scripting: scriptingApi,
  i18n: {
    getMessage: (k) => k,
    getUILanguage: () => "zh-CN",
  },
  extension: { getURL: runtime.getURL },
};

/* ------------------------------------------------------------------ *
 * seeded storage slices so every view has real content to show
 * ------------------------------------------------------------------ */
function seedStorage() {
  const has = (k) => localStorage.getItem(STORAGE_PREFIX + k) != null;
  const put = (k, v) => localStorage.setItem(STORAGE_PREFIX + k, JSON.stringify(v));

  const stats = {};
  SITES.forEach((s, i) => {
    const u = url(s);
    stats[u] = {
      url: u,
      title: s.title,
      host: s.host,
      site: s.host.replace(/^www\./, ""),
      foregroundMs: [42, 8, 130, 3, 61, 17, 96, 25][i % 8] * 60_000,
      activations: [12, 3, 40, 1, 22, 6, 31, 9][i % 8],
      lastVisitAt: T0 - [4, 300, 55, 2880, 90, 1440, 20, 720][i % 8] * MIN,
      firstVisitAt: T0 - (3 + i) * DAY,
      openedAt: T0 - (1 + i) * HOUR,
      lastDiscardAt: i % 5 === 0 ? T0 - 2 * HOUR : 0,
      discardCount: i % 5 === 0 ? 2 : 0,
      lastSleepAt: i % 5 === 0 ? T0 - 2 * HOUR : 0,
    };
  });

  if (!has("stats")) put("stats", stats);
  if (!has("sites"))
    put("sites", {
      "github.com": { host: "github.com", pinned: true, updatedAt: T0 - DAY },
      "news.ycombinator.com": { host: "news.ycombinator.com", protected: true, updatedAt: T0 - 2 * DAY },
    });
  if (!has("lockedCards")) put("lockedCards", ["example-shop.com"]);

  if (!has("collections"))
    put("collections", [
      {
        id: "stash",
        name: "暂存区",
        kind: "stash",
        collapsed: false,
        createdAt: T0 - 6 * DAY,
        items: [
          { id: "it1", title: "MV3 迁移踩坑记录", url: "https://juejin.cn/post/7211", favIconUrl: "", pinned: false, addedAt: T0 - 3 * HOUR, note: "周末读完", source: "manual" },
          { id: "it2", title: "机械键盘 · 购物车", url: "https://example-shop.com/cart", favIconUrl: "", pinned: false, addedAt: T0 - 26 * HOUR, note: "", source: "manual" },
          { id: "it3", title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762", favIconUrl: "", pinned: false, addedAt: T0 - 4 * DAY, note: "精读第 3 节", source: "favorite" },
        ],
      },
      {
        id: "col-papers",
        name: "论文阅读",
        kind: "custom",
        collapsed: false,
        createdAt: T0 - 9 * DAY,
        items: [
          { id: "it4", title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762", favIconUrl: "", pinned: false, addedAt: T0 - 8 * DAY, note: "", source: "manual" },
          { id: "it5", title: "chrome.tabGroups - Mozilla Docs", url: "https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabGroups", favIconUrl: "", pinned: false, addedAt: T0 - 5 * DAY, note: "", source: "manual" },
        ],
      },
      {
        id: "col-shopping",
        name: "购物清单",
        kind: "custom",
        collapsed: true,
        createdAt: T0 - 2 * DAY,
        items: [{ id: "it6", title: "订单 #88213", url: "https://example-shop.com/orders/88213", favIconUrl: "", pinned: false, addedAt: T0 - 30 * MIN, note: "", source: "manual" }],
      },
    ]);

  if (!has("reminders"))
    put("reminders", [
      { id: "rem1", url: "https://youtube.com/watch?v=dQw4w9WgXcQ", urlKey: "https://youtube.com/watch?v=dQw4w9WgXcQ", host: "youtube.com", site: "youtube.com", title: "Building a Chrome Extension in 2026", scope: "page", fireAt: T0 - 6 * MIN, note: "视频该关掉了", createdAt: T0 - 40 * MIN, status: "pending", snoozeCount: 1, lastNotifiedAt: T0 - 6 * MIN, notifiedCount: 1 },
      { id: "rem2", url: "https://github.com/qoder/chrome-tabs-manager", urlKey: "https://github.com/qoder/chrome-tabs-manager", host: "github.com", site: "github.com", title: "chrome-tabs-manager · 仓库", scope: "site", fireAt: T0 + 45 * MIN, note: "回来看看 CI", createdAt: T0 - 2 * HOUR, status: "pending", snoozeCount: 0, lastNotifiedAt: 0, notifiedCount: 0 },
      { id: "rem3", url: "https://news.ycombinator.com/news", urlKey: "https://news.ycombinator.com/news", host: "news.ycombinator.com", site: "ycombinator.com", title: "Hacker News", scope: "page", fireAt: T0 - 3 * HOUR, note: "", createdAt: T0 - 5 * HOUR, status: "done", doneAt: T0 - 3 * HOUR, snoozeCount: 0, lastNotifiedAt: T0 - 3 * HOUR, notifiedCount: 1 },
    ]);

  if (!has("snapshots"))
    put("snapshots", [
      {
        id: "snap1",
        name: "写作工作区 · 周一早上",
        createdAt: T0 - 2 * DAY,
        scope: "all",
        windowCount: 2,
        tabCount: 6,
        restoreCount: 1,
        lastRestoredAt: T0 - DAY,
        hosts: ["docs.google.com", "github.com", "arxiv.org"],
        windows: [
          {
            windowId: 901,
            name: "写作",
            type: "normal",
            state: "normal",
            left: 0,
            top: 0,
            width: 1200,
            height: 800,
            focused: true,
            activeIndex: 0,
            tabs: [
              { index: 0, url: "https://docs.google.com/document/d/1aB2cD3", title: "标签管理器 - 需求评审", pinned: false, active: true, groupId: null, groupTitle: "", groupColor: null, groupCollapsed: false },
              { index: 1, url: "https://arxiv.org/abs/1706.03762", title: "Attention Is All You Need", pinned: true, active: false, groupId: 7, groupTitle: "参考", groupColor: "blue", groupCollapsed: false },
            ],
          },
          {
            windowId: 902,
            name: "窗口 2",
            type: "normal",
            state: "normal",
            left: 120,
            top: 90,
            width: 1100,
            height: 760,
            focused: false,
            activeIndex: 0,
            tabs: [
              { index: 0, url: "https://github.com/qoder/chrome-tabs-manager", title: "chrome-tabs-manager · 仓库", pinned: false, active: true, groupId: null, groupTitle: "", groupColor: null, groupCollapsed: false },
              { index: 1, url: "https://github.com/qoder/chrome-tabs-manager/issues/91", title: "Issues · 标签分组丢失", pinned: false, active: false, groupId: null, groupTitle: "", groupColor: null, groupCollapsed: false },
            ],
          },
        ],
      },
    ]);

  if (!has("trash"))
    put("trash", [
      { id: "tr1", kind: "item", label: "已关闭：知乎回答", payload: { collectionId: "stash", item: { id: "it9", title: "已关闭：知乎回答", url: "https://zhihu.com/question/19550/answer/1", favIconUrl: "", pinned: false, addedAt: T0 - 7 * DAY, note: "", source: "manual" } }, deletedAt: T0 - 5 * HOUR },
    ]);

  if (!has("searches"))
    put("searches", {
      recent: ["chrome.tabs.discard", "标签分组", "shadcn"],
      frequent: { "chrome.tabs.discard": 6, 标签分组: 4, shadcn: 3, arxiv: 2 },
    });

  if (!has("windows")) put("windows", { 1: { name: "开发主窗口" }, 2: { name: "阅读" } });
}

seedStorage();

/* ------------------------------------------------------------------ *
 * dev toolbar
 * ------------------------------------------------------------------ */
export function installMockBanner() {
  if (document.getElementById("mock-bar")) return;
  // dev-only escape hatch so docs screenshots can be captured without the bar
  if (new URLSearchParams(location.search).has("nobanner")) return;
  const bar = document.createElement("div");
  bar.id = "mock-bar";
  bar.style.cssText =
    "position:fixed;left:0;right:0;bottom:0;z-index:9999;display:flex;align-items:center;gap:10px;" +
    "padding:5px 12px;background:#18181b;color:#e4e4e7;font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;" +
    "border-top:1px solid #3f3f46;";
  const badge = document.createElement("span");
  badge.id = "mock-badge";
  bar.append(
    Object.assign(document.createElement("span"), {
      textContent: "MOCK 模式",
      style: "background:#f59e0b;color:#18181b;padding:1px 6px;border-radius:3px;font-weight:700;",
    }),
    Object.assign(document.createElement("span"), {
      textContent: `${tabs.length} 标签 · ${windows.length} 窗口 · ${groups.length} 分组`,
    }),
    badge
  );
  const mk = (label, fn) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = "background:#27272a;color:#e4e4e7;border:1px solid #3f3f46;border-radius:3px;padding:1px 7px;cursor:pointer;font:inherit;";
    b.onclick = fn;
    bar.appendChild(b);
    return b;
  };
  mk("+标签", () => tabsApi.create({ url: `https://example.com/page-${Date.now()}`, windowId: currentWindowId }));
  mk("重置数据", () => {
    for (const k of Object.keys(readAll())) localStorage.removeItem(STORAGE_PREFIX + k);
    location.reload();
  });
  document.body.appendChild(bar);
}

export const mockState = { tabs, windows, groups, bookmarks, history, sessions, currentWindowId: () => currentWindowId };

installMockBanner();
