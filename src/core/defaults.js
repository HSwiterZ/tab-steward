import { deepMerge, uid, now } from "./utils.js";
import { defaultModules } from "./modules.js";

export const DB_VERSION = 1;

export const SORTS = [
  { id: "idle", label: "闲置度", hint: "最久没碰的排在前面" },
  { id: "recent", label: "最近访问", hint: "刚刚用过的排在前面" },
  { id: "usage", label: "使用时长", hint: "前台停留最久的排在前面" },
  { id: "count", label: "标签数量", hint: "同站点开得最多的排在前面" },
  { id: "title", label: "标题", hint: "按站点名字母顺序" },
];

export const PET_APPEARANCES = [
  { id: "wukong", name: "悟空", desc: "金箍棒与筋斗云" },
  { id: "shiba", name: "柴犬", desc: "圆脸豆眉" },
  { id: "cat", name: "灰猫", desc: "总是打盹" },
  { id: "panda", name: "团子", desc: "抱着竹子" },
  { id: "ghost", name: "小幽", desc: "半透明漂浮" },
  { id: "robot", name: "T-800", desc: "冷静汇报" },
  { id: "penguin", name: "企鹅", desc: "滑行爱好者" },
  { id: "fox", name: "赤狐", desc: "尾巴蓬松" },
];

export function defaultSettings() {
  return {
    theme: "system",
    density: "comfortable",

    /* 功能模块开关的唯一来源，见 src/core/modules.js */
    modules: defaultModules(),

    notifications: {
      /* 只影响提醒：留在屏幕上直到处理，「续时」按钮才可能点得到 */
      sticky: true,
    },

    /* 默认开启：发现重复标签时提示。只提示，关不关由用户在提示里选 */
    duplicateWarning: true,

    /* 默认开启：120 分钟自动休眠 */
    autoSleep: {
      enabled: true,
      idleMinutes: 120,
      checkEveryMinutes: 10,
      skipActive: true,
      skipPinned: true,
      skipAudible: true,
      skipAlreadyDiscarded: true,
      skipProtected: true,
      notify: true,
    },

    /* 默认关闭：新标签页展示完整 Dashboard（否则显示极简起始页） */
    newtab: {
      mode: "minimal",
      minimalGreeting: true,
      minimalShowRecent: 6,
    },

    /* LLM 助手：不内置任何端点或密钥，启用与否由 modules.llm 决定 */
    llm: {
      baseUrl: "",
      apiKey: "",
      model: "",
      temperature: 0.3,
      timeoutMs: 30000,
      maxSuggestions: 6,
      lastRunAt: 0,
    },

    experimental: {
      screenshotMaxAgeMinutes: 30,
    },

    reminders: {
      systemNotification: true,
      badge: true,
      dashboardBanner: true,
      defaultOffsetMinutes: 30,
      presets: [5, 15, 30, 60, 120, 480],
    },

    organize: {
      autoGroupByCollection: false,
      groupColorCycle: true,
    },

    view: {
      sort: "idle",
      groupBySite: true,
      windowFilter: "all",
      groupFilter: "all",
      collapsedSites: [],
      collapsedWindows: [],
      showIdleOnly: false,
      idleThresholdMinutes: 60,
    },

    search: {
      includeTabs: true,
      includeStash: true,
      includeBookmarks: true,
      includeHistory: true,
      includeClosed: true,
      historyDays: 30,
      maxResultsPerSource: 8,
    },
  };
}

/** The built-in 暂存区 is a collection with a reserved id; custom ones live beside it. */
export function defaultCollections() {
  return [
    {
      id: "stash",
      name: "暂存区",
      kind: "stash",
      collapsed: false,
      createdAt: now(),
      items: [],
    },
  ];
}

export function defaultDb() {
  return {
    meta: { version: DB_VERSION, installedAt: now(), lastMigrationAt: now() },
    settings: defaultSettings(),
    collections: defaultCollections(),
    /** host -> { pinned, protected, note, firstSeenAt } */
    sites: {},
    /** urlKey -> usage stats */
    stats: {},
    reminders: [],
    snapshots: [],
    trash: [],
    /** windowId -> { name, collapsed } ; window ids are session-scoped */
    windows: {},
    searches: { recent: [], frequent: {} },
    lockedCards: [],
  };
}

/** Reserved collection ids and hard caps that keep the store from growing without bound. */
export const LIMITS = {
  stats: 4000,
  trash: 200,
  snapshots: 40,
  recentSearches: 12,
  frequentSearches: 40,
  reminders: 200,
};

export const TRASH_KINDS = {
  collection: "收藏区",
  item: "收藏项",
  snapshot: "工作区快照",
  site: "站点设置",
};

export function newCollection(name) {
  return {
    id: uid("col"),
    name: name || "新收藏区",
    kind: "custom",
    collapsed: false,
    createdAt: now(),
    items: [],
  };
}

export function newStashItem(tab, extra = {}) {
  return {
    id: uid("it"),
    title: tab.title || tab.url,
    url: tab.url,
    favIconUrl: tab.favIconUrl || "",
    pinned: !!tab.pinned,
    addedAt: now(),
    note: "",
    source: extra.source || "manual",
    ...extra,
  };
}

export function ensureDefaults(db) {
  const base = defaultDb();
  const merged = deepMerge(base, db || {});
  merged.meta.version = DB_VERSION;
  if (!Array.isArray(merged.collections) || !merged.collections.some((c) => c.id === "stash")) {
    merged.collections = [...defaultCollections(), ...(merged.collections || [])];
  }
  return merged;
}
