/**
 * Chrome test double for Node. Deliberately as strict as the real API:
 * argument shapes, storage.onChanged firing for the writing context, alarm
 * name/lookup semantics and tabs.query filters all behave like Chrome, so a
 * passing test here means something.
 */

class Emitter {
  #listeners = [];
  addListener(fn) {
    if (typeof fn !== "function") throw new TypeError("listener must be a function");
    this.#listeners.push(fn);
  }
  removeListener(fn) {
    const i = this.#listeners.indexOf(fn);
    if (i >= 0) this.#listeners.splice(i, 1);
  }
  hasListener(fn) {
    return this.#listeners.includes(fn);
  }
  hasListeners() {
    return this.#listeners.length > 0;
  }
  fire(...args) {
    for (const fn of [...this.#listeners]) fn(...args);
  }
}

const area = (name, backing) => {
  const changed = new Emitter();
  return {
    __name: name,
    __changed: changed,
    async get(keys = null) {
      if (keys == null) return structuredClone(backing);
      const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out = {};
      for (const k of list) if (k in backing) out[k] = structuredClone(backing[k]);
      if (!Array.isArray(keys) && typeof keys === "object" && keys) {
        for (const [k, v] of Object.entries(keys)) if (!(k in out)) out[k] = structuredClone(v);
      }
      return out;
    },
    async set(items) {
      if (typeof items !== "object" || items === null || Array.isArray(items)) throw new TypeError("items must be an object");
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: k in backing ? structuredClone(backing[k]) : undefined, newValue: structuredClone(v) };
        backing[k] = structuredClone(v);
      }
      // Chrome fires onChanged for the writing context too
      queueMicrotask(() => changed.fire(changes, name));
    },
    async remove(keys) {
      const list = typeof keys === "string" ? [keys] : keys;
      const changes = {};
      for (const k of list) {
        if (!(k in backing)) continue;
        changes[k] = { oldValue: structuredClone(backing[k]) };
        delete backing[k];
      }
      queueMicrotask(() => changed.fire(changes, name));
    },
    async clear() {
      for (const k of Object.keys(backing)) delete backing[k];
    },
    async getBytesInUse() {
      return JSON.stringify(backing).length;
    },
    onChanged: changed,
  };
};

const TAB_DEFAULTS = {
  status: "complete",
  active: false,
  highlighted: false,
  pinned: false,
  audible: false,
  discarded: false,
  autoDiscardable: true,
  groupId: -1,
  mutedInfo: { muted: false },
};

export function installChromeStub({ tabs = [], windows = [{ id: 1, type: "normal", focused: true, state: "normal" }] } = {}) {
  const localBacking = {};
  const sessionBacking = {};
  const local = area("local", localBacking);
  const session = area("session", sessionBacking);

  const state = {
    tabs: tabs.map((t, i) => ({ ...TAB_DEFAULTS, id: 100 + i, windowId: 1, index: i, url: "about:blank", title: "", lastAccessed: Date.now(), ...t })),
    windows,
    alarms: new Map(),
    notifications: [],
    menus: new Map(),
    badge: "",
    discarded: [],
    removedTabs: [],
    createdTabs: [],
    movedTabs: [],
  };

  let nextTabId = 1000;
  const tabsApi = {
    async query(info = {}) {
      const known = ["active", "pinned", "audible", "discarded", "currentWindow", "lastFocusedWindow", "windowId", "groupId", "url", "status", "muted", "title"];
      for (const k of Object.keys(info)) {
        if (!known.includes(k)) throw new Error(`chrome.tabs.query: unknown filter "${k}"`);
      }
      return state.tabs
        .filter((t) => {
          if (info.active !== undefined && t.active !== info.active) return false;
          if (info.pinned !== undefined && t.pinned !== info.pinned) return false;
          if (info.audible !== undefined && t.audible !== info.audible) return false;
          if (info.discarded !== undefined && t.discarded !== info.discarded) return false;
          if (info.windowId !== undefined && t.windowId !== info.windowId) return false;
          if (info.groupId !== undefined && t.groupId !== info.groupId) return false;
          if (info.lastFocusedWindow !== undefined && t.windowId !== 1) return false;
          return true;
        })
        .sort((a, b) => a.windowId - b.windowId || a.index - b.index)
        .map((t) => ({ ...t, mutedInfo: { ...t.mutedInfo } }));
    },
    async get(id) {
      const t = state.tabs.find((x) => x.id === id);
      if (!t) throw new Error(`No tab with id: ${id}`);
      return { ...t };
    },
    async create(props = {}) {
      if (props.url && typeof props.url !== "string") throw new TypeError("url must be a string");
      const tab = { ...TAB_DEFAULTS, id: nextTabId++, windowId: props.windowId ?? 1, index: state.tabs.length, url: props.url || "chrome://newtab/", title: props.title || "", active: props.active !== false, lastAccessed: Date.now() };
      state.tabs.push(tab);
      state.createdTabs.push({ ...tab });
      return { ...tab };
    },
    async update(id, props = {}) {
      const t = state.tabs.find((x) => x.id === id);
      if (!t) throw new Error(`No tab with id: ${id}`);
      Object.assign(t, props);
      return { ...t };
    },
    async remove(ids) {
      for (const id of Array.isArray(ids) ? ids : [ids]) {
        const i = state.tabs.findIndex((t) => t.id === id);
        if (i === -1) throw new Error(`No tab with id: ${id}`);
        state.removedTabs.push({ ...state.tabs[i] });
        state.tabs.splice(i, 1);
      }
    },
    async discard(id) {
      const t = state.tabs.find((x) => x.id === id);
      if (!t) throw new Error(`No tab with id: ${id}`);
      if (t.active) throw new Error("Error: The active tab of a window cannot be discarded.");
      t.discarded = true;
      state.discarded.push(id);
      return { ...t };
    },
    async reload() {},
    async move(ids, props) {
      for (const id of Array.isArray(ids) ? ids : [ids]) state.movedTabs.push({ id, ...props });
    },
    onUpdated: new Emitter(),
    onRemoved: new Emitter(),
    onCreated: new Emitter(),
    onActivated: new Emitter(),
  };

  const alarmsApi = {
    create(name, info) {
      if (typeof name !== "string") throw new TypeError("alarm name must be a string");
      if (!info || typeof info !== "object") throw new TypeError("alarm info must be an object");
      if (info.periodInMinutes != null && info.periodInMinutes < 1) {
        throw new Error("Error: Operation requires alarms.periodInMinutes >= 1");
      }
      const when = info.when ?? (info.delayInMinutes != null ? Date.now() + info.delayInMinutes * 60_000 : Date.now() + 60_000);
      state.alarms.set(name, { name, when, periodInMinutes: info.periodInMinutes });
    },
    async get(name) {
      const a = state.alarms.get(name);
      return a ? { name: a.name, scheduledTime: a.when, periodInMinutes: a.periodInMinutes } : undefined;
    },
    async getAll() {
      return [...state.alarms.values()].map((a) => ({ name: a.name, scheduledTime: a.when, periodInMinutes: a.periodInMinutes }));
    },
    async clear(name) {
      return state.alarms.delete(name);
    },
    async clearAll() {
      state.alarms.clear();
      return true;
    },
    onAlarm: new Emitter(),
  };

  let nextWindowId = state.windows.reduce((m, w) => Math.max(m, w.id), 0) + 1;
  const windowsOnCreated = new Emitter();
  const windowsOnFocusChanged = new Emitter();
  const windowsOnRemoved = new Emitter();

  const api = {
    __state: state,
    runtime: {
      id: "testextensionid",
      lastError: undefined,
      getURL: (p) => `chrome-extension://testextensionid/${String(p).replace(/^\//, "")}`,
      getManifest: () => ({ manifest_version: 3, version: "1.0.0" }),
      async sendMessage(msg) {
        if (!msg || typeof msg.type !== "string") throw new TypeError("message needs a type");
        return undefined;
      },
      onMessage: new Emitter(),
      onInstalled: new Emitter(),
      onStartup: new Emitter(),
      openOptionsPage() {},
    },
    storage: { local, session, sync: area("sync", {}), managed: area("managed", {}), onChanged: local.onChanged },
    tabs: tabsApi,
    windows: {
      async getAll({ populate = false } = {}) {
        return state.windows.map((w) => {
          const copy = { ...w };
          if (populate) copy.tabs = state.tabs.filter((t) => t.windowId === w.id).sort((a, b) => a.index - b.index).map((t) => ({ ...t }));
          return copy;
        });
      },
      async get(id) {
        const w = state.windows.find((x) => x.id === id);
        if (!w) throw new Error(`No window with id: ${id}`);
        return { ...w };
      },
      async getCurrent() {
        return { ...state.windows[0] };
      },
      async getLastFocused() {
        return { ...state.windows.find((w) => w.focused) };
      },
      async update(id, props) {
        const w = state.windows.find((x) => x.id === id);
        if (!w) throw new Error(`No window with id: ${id}`);
        Object.assign(w, props);
        return { ...w };
      },
      async create(props = {}) {
        const urls = Array.isArray(props.url) ? props.url : props.url ? [props.url] : [];
        const win = {
          id: nextWindowId++,
          type: props.type || "normal",
          state: props.state || "normal",
          focused: props.focused !== false,
          incognito: false,
          left: props.left ?? 0,
          top: props.top ?? 0,
          width: props.width ?? 1280,
          height: props.height ?? 720,
        };
        state.windows.push(win);
        if (props.tabId != null) await tabsApi.update(props.tabId, { windowId: win.id });
        for (const [i, u] of urls.entries()) await tabsApi.create({ url: u, windowId: win.id, active: i === urls.length - 1 });
        queueMicrotask(() => windowsOnCreated.fire({ ...win }));
        return { ...win };
      },
      async remove(id) {
        const i = state.windows.findIndex((w) => w.id === id);
        if (i === -1) throw new Error(`No window with id: ${id}`);
        const [win] = state.windows.splice(i, 1);
        for (const t of state.tabs.filter((t) => t.windowId === id)) await tabsApi.remove(t.id);
        queueMicrotask(() => windowsOnRemoved.fire(id));
        return { ...win };
      },
      onFocusChanged: windowsOnFocusChanged,
      onRemoved: windowsOnRemoved,
      onCreated: windowsOnCreated,
    },
    tabGroups: {
      async query() {
        return [];
      },
      async get(id) {
        throw new Error(`No group with id: ${id}`);
      },
      async update() {},
      TAB_GROUP_ID_NONE: -1,
      onUpdated: new Emitter(),
    },
    alarms: alarmsApi,
    action: {
      async setBadgeText({ text }) {
        if (typeof text !== "string") throw new TypeError("badge text must be a string");
        state.badge = text;
      },
      async getBadgeText() {
        return state.badge;
      },
      async setBadgeBackgroundColor() {},
    },
    notifications: {
      async create(id, options) {
        if (!options || !options.type) throw new TypeError("notification requires a type");
        if (options.iconUrl && !/^chrome-extension:|^data:|^https?:/.test(options.iconUrl)) throw new Error("invalid iconUrl");
        if (options.priority !== undefined && (options.priority < -2 || options.priority > 2)) {
          throw new RangeError("notification priority must be between -2 and 2");
        }
        // Windows / Linux / macOS have no notification center: -2 and -1 are
        // refused outright and the notification is never shown at all.
        if (options.priority === -1 || options.priority === -2) {
          throw new Error(`notification priority ${options.priority} is not supported on this platform`);
        }
        state.notifications.push({ id, ...options });
        return id;
      },
      async clear(id) {
        const i = state.notifications.findIndex((n) => n.id === id);
        if (i >= 0) state.notifications.splice(i, 1);
        return i >= 0;
      },
      onClicked: new Emitter(),
      onButtonClicked: new Emitter(),
    },
    bookmarks: { async search() { return []; }, async getTree() { return [{ id: "0", title: "", children: [] }]; } },
    history: { async search() { return []; } },
    sessions: { async getRecentlyClosed() { return []; } },
    contextMenus: {
      // Chrome's create is callback-only (returns undefined) and refuses a child
      // whose parent is not registered yet. Mirror both: an `await` on the raw
      // call is a no-op, and out-of-order creation must fail here, not only in
      // a real browser after the extension is reloaded.
      create(props, callback) {
        const id = String(props?.id ?? props?.title ?? "");
        const register = () => {
          let error = "";
          if (state.menus.has(id)) error = `Cannot create item with duplicate id ${id}`;
          else if (props?.parentId && !state.menus.has(String(props.parentId))) error = `Cannot find menu item with id ${props.parentId}`;
          else state.menus.set(id, { ...props });
          if (typeof callback === "function") {
            api.runtime.lastError = error ? { message: error } : undefined;
            try {
              callback();
            } finally {
              api.runtime.lastError = undefined;
            }
          } else if (error) {
            throw new Error(error);
          }
        };
        // An icon has to be loaded before Chrome registers the item, so the
        // parent check happens later than the call. That delay is what turned
        // "create parent, then child" into "Cannot find menu item with id".
        if (props?.icons) setTimeout(register, 1);
        else queueMicrotask(register);
        return undefined;
      },
      removeAll(callback) {
        state.menus.clear();
        if (typeof callback === "function") queueMicrotask(callback);
      },
      onClicked: new Emitter(),
    },
    commands: { onCommand: new Emitter() },
    permissions: { async contains() { return false; }, async request() { return false; } },
  };

  globalThis.chrome = api;
  return api;
}

export function resetChrome() {
  delete globalThis.chrome;
}
