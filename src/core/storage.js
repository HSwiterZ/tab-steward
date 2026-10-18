import { deepMerge, isPlainObject } from "./utils.js";
import { defaultSettings, defaultCollections, DB_VERSION } from "./defaults.js";

const AREA = "local";

/**
 * Storage is split into one key per slice so a tab activation doesn't rewrite
 * snapshots and collections along with it.
 */
const SLICES = {
  meta: () => ({ version: DB_VERSION, installedAt: Date.now(), lastMigrationAt: Date.now() }),
  settings: defaultSettings,
  collections: defaultCollections,
  sites: () => ({}),
  stats: () => ({}),
  reminders: () => [],
  snapshots: () => [],
  trash: () => [],
  windows: () => ({}),
  searches: () => ({ recent: [], frequent: {} }),
  lockedCards: () => [],
  screenshots: () => ({}),
};

export function registerSlice(name, factory) {
  SLICES[name] = factory;
}

const hasChromeStorage = () =>
  typeof chrome !== "undefined" && !!chrome.storage?.local && typeof chrome.storage.local.get === "function";

class Store {
  #cache = new Map();
  #listeners = new Map(); // slice -> Set(fn)
  #anyListeners = new Set();
  #writes = new Map(); // slice -> in-flight promise
  #loaded = false;
  #pendingChanges = [];
  ready;

  constructor() {
    // Registered synchronously: a service worker only receives events for
    // listeners added during the first turn of the script.
    if (hasChromeStorage()) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== AREA) return;
        if (!this.#loaded) {
          this.#pendingChanges.push(changes);
          return;
        }
        this.#applyChanges(changes);
      });
    }
    this.ready = this.#load();
  }

  async #load() {
    if (!hasChromeStorage()) {
      for (const [name, factory] of Object.entries(SLICES)) {
        this.#cache.set(name, factory ? factory() : undefined);
      }
      this.#loaded = true;
      return;
    }
    const names = Object.keys(SLICES);
    const raw = await chrome.storage.local.get(names);
    for (const name of names) {
      const factory = SLICES[name];
      const fallback = factory ? factory() : undefined;
      const value = raw[name];
      this.#cache.set(name, value === undefined ? fallback : this.#revive(name, value, fallback));
    }
    this.#loaded = true;
    // Replay anything that landed while we were reading, newest write wins.
    const queued = this.#pendingChanges;
    this.#pendingChanges = [];
    for (const changes of queued) this.#applyChanges(changes);
  }

  #applyChanges(changes) {
    for (const [name, { newValue }] of Object.entries(changes)) {
      if (!(name in SLICES)) continue;
      const fallback = SLICES[name] ? SLICES[name]() : undefined;
      this.#cache.set(name, newValue === undefined ? fallback : this.#revive(name, newValue, fallback));
      this.#emit(name, newValue);
    }
  }

  /** Hook for per-slice schema repair without a full migration pass. */
  #revive(name, value, fallback) {
    if (name === "settings" && isPlainObject(fallback)) return deepMerge(fallback, value);
    return value;
  }

  get(name) {
    return this.#cache.get(name);
  }

  has(name) {
    return this.#cache.has(name);
  }

  async set(name, value, { silent = false } = {}) {
    this.#cache.set(name, value);
    if (!silent) this.#emit(name, value, true);
    await this.#persist(name, value);
    return value;
  }

  /** Shallow-then-deep merge for object slices such as settings/sites/stats. */
  async patch(name, partial) {
    const current = this.get(name);
    const next = isPlainObject(current) ? deepMerge(current, partial) : { ...current, ...partial };
    return this.set(name, next);
  }

  /** Read-modify-write with the freshest cached value. */
  async update(name, fn) {
    const next = await fn(this.get(name));
    return this.set(name, next);
  }

  async #persist(name, value) {
    if (!hasChromeStorage()) return;
    const prev = this.#writes.get(name);
    const run = (prev || Promise.resolve())
      .catch(() => {})
      .then(() => chrome.storage.local.set({ [name]: value }))
      .catch((err) => console.error(`[store] persist ${name} failed`, err));
    this.#writes.set(name, run);
    await run;
    if (this.#writes.get(name) === run) this.#writes.delete(name);
  }

  on(name, fn) {
    if (!this.#listeners.has(name)) this.#listeners.set(name, new Set());
    this.#listeners.get(name).add(fn);
    return () => this.#listeners.get(name)?.delete(fn);
  }

  onAny(fn) {
    this.#anyListeners.add(fn);
    return () => this.#anyListeners.delete(fn);
  }

  #emit(name, value, local = false) {
    for (const fn of this.#listeners.get(name) || []) {
      try {
        fn(value, name, local);
      } catch (err) {
        console.error(`[store] listener error on ${name}`, err);
      }
    }
    for (const fn of this.#anyListeners) {
      try {
        fn(name, value, local);
      } catch (err) {
        console.error("[store] listener error", err);
      }
    }
  }

  /** Full-database view, used by export/import and diagnostics. */
  snapshotAll() {
    const out = {};
    for (const name of Object.keys(SLICES)) out[name] = this.get(name);
    return out;
  }

  async importAll(data, { mode = "merge" } = {}) {
    const errors = [];
    for (const [name, value] of Object.entries(data)) {
      if (!(name in SLICES)) {
        errors.push(`未知数据段：${name}`);
        continue;
      }
      if (name === "meta") continue;
      if (mode === "overwrite") {
        await this.set(name, value);
      } else {
        const current = this.get(name);
        await this.set(name, mergeSlice(name, current, value));
      }
    }
    return { errors };
  }

  async clearAll() {
    for (const [name, factory] of Object.entries(SLICES)) {
      await this.set(name, factory ? factory() : undefined);
    }
  }
}

function mergeSlice(name, current, incoming) {
  if (Array.isArray(incoming)) {
    if (!Array.isArray(current)) return incoming;
    if (name === "collections") return mergeCollections(current, incoming);
    const byId = new Map(current.map((x) => [x?.id, x]));
    for (const item of incoming) if (item?.id && !byId.has(item.id)) byId.set(item.id, item);
    return [...byId.values()];
  }
  if (isPlainObject(incoming)) {
    if (!isPlainObject(current)) return incoming;
    if (name === "settings") return deepMerge(current, incoming);
    return { ...current, ...incoming };
  }
  return incoming;
}

function mergeCollections(current, incoming) {
  const out = current.map((c) => ({ ...c, items: [...(c.items || [])] }));
  for (const col of incoming) {
    if (!col?.id) continue;
    const existing = out.find((c) => c.id === col.id);
    if (!existing) {
      out.push({ ...col, items: [...(col.items || [])] });
      continue;
    }
    const seen = new Set(existing.items.map((i) => i.id));
    for (const item of col.items || []) if (!seen.has(item.id)) existing.items.push(item);
  }
  return out;
}

export const store = new Store();

/** Convenience accessor for the settings slice. */
export const settings = {
  get: () => store.get("settings") || {},
  patch: (partial) => store.patch("settings", partial),
  set: (value) => store.set("settings", value),
  on: (fn) => store.on("settings", fn),
};
