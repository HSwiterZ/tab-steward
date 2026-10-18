/**
 * Shared, DOM-free helpers. Safe to import from the service worker and pages.
 */

export const uid = (prefix = "id") =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const now = () => Date.now();

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Strip fragments, tracking params and a trailing slash so "same page" matches. */
export function urlKey(rawUrl) {
  if (!rawUrl) return "";
  try {
    const u = new URL(rawUrl);
    if (u.protocol === "chrome:" || u.protocol === "edge:" || u.protocol === "about:") {
      return rawUrl.replace(/#.*$/, "");
    }
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|igshid|ref_|referrer$)/i.test(k)) u.searchParams.delete(k);
    }
    if (!u.searchParams.toString()) u.search = "";
    if (!/^https?:$/.test(u.protocol)) {
      let s = u.toString();
      if (s.endsWith("/")) s = s.slice(0, -1);
      return s;
    }
    let path = u.pathname;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    return u.origin + (path === "/" ? "" : path) + u.search;
  } catch {
    return rawUrl;
  }
}

export function hostname(rawUrl) {
  if (!rawUrl) return "";
  try {
    const u = new URL(rawUrl);
    if (u.protocol === "chrome-extension:") return "extension";
    if (!u.hostname) return u.protocol.replace(":", "");
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**Registrable-ish domain: keeps the last two labels (good enough for grouping). */
export function siteOf(rawUrl) {
  const h = hostname(rawUrl);
  if (!h) return "";
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  const second = parts[parts.length - 2];
  if (/^(com|net|org|gov|edu|co|ac)$/i.test(second)) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}

export function titleOf(url) {
  const h = hostname(url);
  if (!h) return url || "";
  try {
    const p = new URL(url).pathname.replace(/\/+$/, "");
    if (!p) return h;
    return `${h}${p}`;
  } catch {
    return h;
  }
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function formatDuration(ms) {
  if (!ms || ms < 0) return "0 分钟";
  if (ms < MIN) return `${Math.round(ms / 1000)} 秒`;
  if (ms < HOUR) return `${Math.round(ms / MIN)} 分钟`;
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR);
    const m = Math.round((ms % HOUR) / MIN);
    return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
  }
  const d = Math.floor(ms / DAY);
  const h = Math.round((ms % DAY) / HOUR);
  return h ? `${d} 天 ${h} 小时` : `${d} 天`;
}

export function formatShortDuration(ms) {
  if (!ms || ms < 0) return "—";
  if (ms < MIN) return `${Math.round(ms / 1000)}s`;
  if (ms < HOUR) return `${Math.round(ms / MIN)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  return `${Math.floor(ms / DAY)}d`;
}

export function formatRelative(ts, reference = Date.now()) {
  if (!ts) return "从未";
  const diff = reference - ts;
  if (diff < 0) return formatClock(ts);
  if (diff < 45_000) return "刚刚";
  if (diff < HOUR) return `${Math.round(diff / MIN)} 分钟前`;
  if (diff < DAY) return `${Math.round(diff / HOUR)} 小时前`;
  if (diff < 30 * DAY) return `${Math.round(diff / DAY)} 天前`;
  return formatDate(ts);
}

export function formatClock(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function formatDateTime(ts) {
  return `${formatDate(ts)} ${formatClock(ts)}`;
}

/** "今天" / "昨天" / date — used to bucket history. */
export function dayBucket(ts) {
  const d = new Date(ts);
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / DAY);
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) return `${diffDays} 天前`;
  return formatDate(ts);
}

export function groupBy(list, keyFn) {
  const out = new Map();
  for (const item of list) {
    const k = keyFn(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return out;
}

export function sortBy(list, keyFn, dir = "asc") {
  const sign = dir === "desc" ? -1 : 1;
  return [...list].sort((a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    if (ka === kb) return 0;
    if (ka == null) return 1;
    if (kb == null) return -1;
    return (ka > kb ? 1 : -1) * sign;
  });
}

export function uniq(list) {
  return [...new Set(list)];
}

export function moveItem(list, from, to) {
  const next = [...list];
  if (from === to || from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to < 0 ? next.length : Math.min(to, next.length), 0, item);
  return next;
}

export function debounce(fn, ms = 200) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  wrapped.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return wrapped;
}

export function throttle(fn, ms = 200) {
  let last = 0;
  let timer = null;
  return (...args) => {
    const remaining = ms - (Date.now() - last);
    if (remaining <= 0) {
      last = Date.now();
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn(...args);
      }, remaining);
    }
  };
}

/** Deep merge where plain objects merge and everything else (arrays included) replaces. */
export function deepMerge(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v === undefined ? base[k] : deepMerge(base[k], v);
  }
  return out;
}

export function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

export function omit(obj, keys) {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

export function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        resolve(JSON.parse(String(fr.result)));
      } catch (err) {
        reject(new Error(`JSON 解析失败：${err.message}`));
      }
    };
    fr.onerror = () => reject(new Error("文件读取失败"));
    fr.readAsText(file, "utf-8");
  });
}

/** Favicon through the extension's own _favicon endpoint. "" means: use the letter tile. */
export function faviconFor(url, size = 32) {
  if (!url) return "";
  // The dev harness has no extension host to serve _favicon from. When the
  // endpoint is unavailable we return "" rather than fall back to a third-party
  // favicon service — that would hand the site to the service and break the
  // "no network except the user's own LLM endpoint" privacy claim.
  if (globalThis.__MOCK_CHROME__) return "";
  try {
    const u = new URL(chrome.runtime.getURL("/_favicon/"));
    u.searchParams.set("pageUrl", url);
    u.searchParams.set("size", String(size));
    return u.toString();
  } catch {
    return "";
  }
}

export const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Required whenever untrusted text (titles, URLs, query) is placed into an HTML string. */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

export function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Wrap every case-insensitive match of `query` in <mark>. Both sides are escaped
 * first, so the result is safe to assign to innerHTML.
 */
export function highlight(text, query) {
  const safe = escapeHtml(text);
  const q = String(query || "").trim();
  if (!q) return safe;
  const re = new RegExp(escapeRegExp(escapeHtml(q)), "gi");
  return safe.replace(re, (m) => `<mark>${m}</mark>`);
}

/** Split a haystack into matched/unmatched runs without touching HTML. */
export function matchRanges(text, query) {
  const hay = String(text ?? "");
  const q = String(query || "").trim().toLowerCase();
  const out = [];
  if (!q) return [{ text: hay, hit: false }];
  let i = 0;
  const lower = hay.toLowerCase();
  while (i < hay.length) {
    const idx = lower.indexOf(q, i);
    if (idx === -1) {
      out.push({ text: hay.slice(i), hit: false });
      break;
    }
    if (idx > i) out.push({ text: hay.slice(i, idx), hit: false });
    out.push({ text: hay.slice(idx, idx + q.length), hit: true });
    i = idx + q.length;
  }
  return out;
}

