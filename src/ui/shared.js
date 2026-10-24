import { h, ico, clear, append, installTooltips, applyTheme, watchTheme, toast, confirmDialog, openDialog, promptDialog, copyText, Badge, Button, IconButton, MenuButton } from "./kit.js";
import { store } from "../core/storage.js";
import { faviconFor, hostname, siteOf, formatShortDuration, formatDuration, formatRelative, debounce } from "../core/utils.js";
import { unifiedSearch, recentSearches, frequentSearches, recordSearch, SOURCE_LABEL, availableSources } from "../core/search.js";
import { isOn } from "../core/modules.js";
import { IDLE_BANDS, resetIdleFor } from "../core/stats.js";
import { focusTab, closeTabs, sleepTabs, wakeTabs, pinTabs } from "../core/actions.js";
import { stashTabs, listCollections, createCollection, STASH_ID } from "../core/collections.js";

/* ====================================================================== *
 * module gate — every surface asks through this one call, so a disabled
 * module disappears from popup, dashboard, palette and side panel alike
 * ====================================================================== */

export const featureOn = (id) => isOn(store.get("settings") || {}, id);

/** One search hint for every surface that opens the palette, reflecting live sources. */
export const paletteHint = () => `搜索${availableSources().map((s) => s.short).join(" / ")}…`;

/**
 * Open settings in a tab of its own. `openOptionsPage()` can replace the page
 * that called it — from the Dashboard that leaves browser Back as the only way
 * home. Reusing/creating a tab keeps the caller alive, and the settings page's
 * own return control brings focus back here.
 */
export async function openSettingsTab() {
  const url = chrome.runtime.getURL("src/options/index.html");
  const existing = (await chrome.tabs.query({ url }).catch(() => [])).find((t) => t.url === url);
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
    return existing;
  }
  // Remember the caller so Settings can hand focus back to this exact tab —
  // including a new-tab page that is showing the Dashboard inline.
  const me = await chrome.tabs.getCurrent?.().catch?.(() => null);
  return chrome.tabs.create({
    url,
    active: true,
    ...(me?.id != null ? { openerTabId: me.id } : {}),
  });
}

/* ====================================================================== *
 * page bootstrap
 * ====================================================================== */

export async function bootPage(main) {
  installTooltips();
  const settings = store.get("settings") || {};
  watchTheme(settings.theme || "system");
  store.on("settings", (next) => applyTheme(next?.theme || "system"));
  await store.ready;
  return main();
}

/* ====================================================================== *
 * favicon with graceful fallback
 * ====================================================================== */

// Site identity colours. Deliberately skips the 225-285 band so a favicon tile
// never reads as brand-coloured app chrome.
const TILE_HUES = [199, 320, 348, 142, 25, 189, 0, 40, 292, 172];

export function tileColor(seed) {
  const s = String(seed || "");
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum = (sum * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${TILE_HUES[sum % TILE_HUES.length]} 62% 46%)`;
}

export function letterTile(seed, size = 16, { tinted = false } = {}) {
  const letter = (String(seed || "?").replace(/^www\./, "").charAt(0) || "?").toUpperCase();
  const hue = tileHue(seed);
  return h(
    "div.tile",
    {
      style: {
        width: `${size}px`,
        height: `${size}px`,
        background: tinted ? `hsl(${hue} 70% 46% / 0.14)` : tileColor(seed),
        color: tinted ? `hsl(${hue} 70% 42%)` : "#fff",
        fontSize: `${Math.max(9, Math.round(size * 0.5))}px`,
        borderRadius: `${Math.max(5, Math.round(size * 0.3))}px`,
      },
      title: seed,
    },
    letter
  );
}

function tileHue(seed) {
  const s = String(seed || "");
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum = (sum * 31 + s.charCodeAt(i)) >>> 0;
  return TILE_HUES[sum % TILE_HUES.length];
}

export function Favicon({ url, size = 16, cls = "tab-fav", tinted = false }) {
  const host = hostname(url);
  const src = faviconFor(url, 32);
  if (!src || /^(chrome|edge|about|devtools|chrome-extension):/.test(url || "")) return letterTile(host || "•", size, { tinted });
  const img = h(`img.${cls}`, { src, width: size, height: size, alt: "", loading: "lazy", decoding: "async" });
  if (tinted) {
    img.style.borderRadius = `${Math.max(5, Math.round(size * 0.3))}px`;
    img.style.background = `hsl(${tileHue(host)} 70% 46% / 0.14)`;
    img.style.padding = `${Math.round(size * 0.14)}px`;
    img.style.boxSizing = "border-box";
  }
  img.addEventListener("error", () => {
    img.replaceWith(letterTile(host, size, { tinted }));
  });
  return img;
}

/* ====================================================================== *
 * small badges
 * ====================================================================== */

export function IdleBadge({ idleScore, idleMs, discarded }) {
  const band = IDLE_BANDS.find((b) => idleScore < b.max) || IDLE_BANDS[IDLE_BANDS.length - 1];
  return h(
    "span.row.gap-1",
    { title: `闲置 ${formatRelative(Date.now() - idleMs)} · 闲置度 ${idleScore}` },
    h("span.idle-bar", h("span.idle-bar-fill", { class: `tone-${band.tone}`, style: { width: `${Math.max(6, idleScore)}%` } })),
    discarded ? Badge({ label: "休眠", variant: "muted", emoji: "zzz" }) : null
  );
}

export function groupChip(title, color) {
  if (!title && !color) return null;
  return h("span.group-chip", { style: { "--tg-color": `var(--tg-${color || "grey"})` }, title: "标签组" }, title || "未命名分组");
}

export function stateChips(tab) {
  const chips = [];
  if (tab.pinned) chips.push(Badge({ label: "固定", variant: "secondary", icon: "pin" }));
  if (tab.audible) chips.push(Badge({ label: "有声", variant: "secondary", icon: "volume" }));
  if (tab.discarded) chips.push(Badge({ label: "已休眠", variant: "muted", emoji: "zzz" }));
  if (tab.protectedSite) chips.push(Badge({ label: "受保护", variant: "secondary", icon: "shield-check" }));
  if (featureOn("duplicates") && tab.dupeCount) chips.push(Badge({ label: `重复 ×${tab.dupeCount + 1}`, variant: "warning", icon: "copy" }));
  return chips;
}

/* ====================================================================== *
 * tab row
 * ====================================================================== */

/**
 * @param {object} tab enriched tab
 * @param {object} opts { query, selected, onSelect, onOpen, actions, showWindow, showSite, locked, compact }
 */
/* ------------------------------------------------------------------ *
 * hover screenshot preview (screenshotPreview module)
 * ------------------------------------------------------------------ */

let previewNode = null;
let previewTimer = null;

function hidePreview() {
  if (previewTimer) {
    clearTimeout(previewTimer);
    previewTimer = null;
  }
  previewNode?.remove();
  previewNode = null;
}

/** Show the cached screenshot of this tab beside the row the pointer rests on. */
export function installHoverPreview(row, getUrl) {
  row.addEventListener("mouseenter", () => {
    if (!featureOn("screenshotPreview") || previewTimer) return;
    previewTimer = setTimeout(async () => {
      previewTimer = null;
      const res = await chrome.runtime.sendMessage({ type: "capture:get", payload: { url: getUrl() } }).catch(() => null);
      if (!res?.data) return;
      hidePreview();
      const r = row.getBoundingClientRect();
      previewNode = h("div.hover-preview", h("img.preview-img", { src: res.data, alt: "" }), h("div.hover-preview-cap", res.title || getUrl()));
      document.body.appendChild(previewNode);
      const w = previewNode.offsetWidth || 300;
      const ht = previewNode.offsetHeight || 200;
      const below = r.bottom + 6;
      previewNode.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + 28))}px`;
      previewNode.style.top = `${below + ht > window.innerHeight ? Math.max(8, r.top - ht - 6) : below}px`;
    }, 420);
  });
  row.addEventListener("mouseleave", hidePreview);
}

/**
 * The tab a drag started from. Same-document only, so the live object travels
 * instead of a re-parsed copy: the collections panel needs its url/title/id to
 * build a stash item.
 */
export const tabDrag = { tab: null };

export function TabRow(tab, opts = {}) {
  const { query = "", selected = false, showWindow = false, showSite = false, locked = false, compact = false } = opts;
  const band = IDLE_BANDS.find((b) => tab.idleScore < b.max) || IDLE_BANDS[IDLE_BANDS.length - 1];

  const row = h(
    "div.tab-row",
    {
      dataset: { id: String(tab.id), active: String(!!tab.active), discarded: String(!!tab.discarded), selected: String(selected) },
      tabindex: "0",
      role: "option",
      draggable: "true",
      title: `${tab.title}\n${tab.url}`,
    },
    opts.checkbox || null,
    Favicon({ url: tab.url, size: compact ? 22 : 26, tinted: true }),
    h(
      "div.col.flex-1.min-h-0",
      h("div.tab-title", { marks: { text: tab.title || tab.url, query } }),
      h(
        "div.row.gap-1.wrap",
        { style: { marginTop: "1px" } },
        h("div.tab-url", { marks: { text: showSite ? tab.site : tab.url.replace(/^https?:\/\//, ""), query } }),
        showWindow ? h("span.badge.badge-outline", opts.windowLabel || "窗口") : null,
        tab.groupId > -1 && opts.groups ? groupChip(opts.groups.get(tab.groupId)?.title, opts.groups.get(tab.groupId)?.color) : null,
        ...stateChips(tab),
        tab.active
          ? Badge({ label: "正在使用", variant: "success" })
          : Badge({ label: `${formatShortDuration(tab.idleMs)} 未用 · 闲置 ${tab.idleScore}`, variant: band.tone === "secondary" ? "outline" : band.tone })
      )
    ),
    h(
      "div.tab-actions",
      ...(locked
        ? [IconButton({ emoji: "locked", label: "卡片已锁定，操作被禁用", size: "xs", disabled: true })]
        : opts.actions || [])
    )
  );

  row.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    opts.onOpen?.(tab, e);
  });
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter") opts.onOpen?.(tab, e);
  });
  row.addEventListener("dragstart", (e) => {
    tabDrag.tab = tab;
    row.dataset.dragging = "true";
    e.dataTransfer.effectAllowed = "copyMove";
    e.dataTransfer.setData("text/plain", tab.url);
  });
  row.addEventListener("dragend", () => {
    tabDrag.tab = null;
    row.dataset.dragging = "false";
  });
  installHoverPreview(row, () => tab.url);
  return row;
}

/* ====================================================================== *
 * site card
 * ====================================================================== */

export function SiteCard(card, opts = {}) {
  const expanded = opts.expanded;
  const shown = expanded ? card.tabs : card.tabs.slice(0, 3);
  const hidden = card.tabs.length - shown.length;
  const band = IDLE_BANDS.find((b) => card.avgIdle < b.max) || IDLE_BANDS[IDLE_BANDS.length - 1];

  const body = h(
    "div.site-card-body",
    ...shown.map((tab) =>
      TabRow(tab, {
        query: opts.query,
        selected: opts.selectedIds?.has(tab.id),
        showWindow: card.windowIds.size > 1,
        windowLabel: opts.windowLabels?.get(tab.windowId),
        groups: opts.groups,
        locked: card.locked,
        actions: opts.tabActions?.(tab),
        onOpen: opts.onOpenTab,
        checkbox: opts.checkboxFor?.(tab),
      })
    ),
    hidden > 0
      ? h(
          "button.btn.btn-ghost.btn-xs",
          { style: { margin: "2px 8px 6px", alignSelf: "flex-start" }, onClick: () => opts.onToggle?.(card.site) },
          ico("chevron-down", 12),
          `展开其余 ${hidden} 个`
        )
      : expanded && card.tabs.length > 3
        ? h(
            "button.btn.btn-ghost.btn-xs",
            { style: { margin: "2px 8px 6px", alignSelf: "flex-start" }, onClick: () => opts.onToggle?.(card.site) },
            ico("chevron-up", 12),
            "收起"
          )
        : null
  );

  const el = h(
    "div.site-card",
    { dataset: { site: card.site, locked: String(!!card.locked) } },
    h(
      "div.site-card-head",
      Favicon({ url: card.tabs[0]?.url, size: 30, tinted: true }),
      h(
        "div.col.flex-1.min-h-0",
        h("div.site-card-title.truncate", card.site),
        h("div.row.gap-1.wrap", { style: { marginTop: "3px" } },
          Badge({ label: `${card.tabs.length} 个`, variant: "secondary" }),
          Badge({ label: `闲置度 ${card.avgIdle}`, variant: band.tone === "secondary" ? "outline" : band.tone }),
          Badge({ label: `最近 ${formatShortDuration(Math.max(0, Date.now() - card.lastVisitAt))}`, variant: "outline" }),
          card.discarded ? Badge({ label: `${card.discarded} 休眠`, variant: "muted", emoji: "zzz" }) : null,
          card.audible ? Badge({ label: "有声", variant: "secondary", icon: "volume" }) : null,
          card.pinnedSite ? Badge({ label: "置顶", variant: "secondary", icon: "pin" }) : null
        )
      ),
      card.locked
        ? IconButton({ emoji: "locked", label: "已锁定：关闭/休眠被禁用", size: "xs", variant: "ghost", onClick: (e) => { e.stopPropagation(); opts.onUnlock?.(card); } })
        : null,
      MenuButton({
        emoji: "gear",
        label: `${card.site} 操作`,
        size: "xs",
        items: () => opts.cardMenu?.(card) || [],
      })
    ),
    body,
    card.tabs.length > 3 || opts.cardFooter
      ? h(
          "div.site-card-foot",
          ...(opts.cardFooter?.(card) || [
            h("button.btn.btn-ghost.btn-xs", { onClick: () => opts.onToggle?.(card.site) }, ico(expanded ? "chevron-up" : "chevron-down", 12), expanded ? "收起" : "展开"),
          ])
        )
      : null
  );
  return el;
}

/* ====================================================================== *
 * standard per-tab actions: three primary buttons + an overflow menu, so
 * row titles keep enough room to stay readable
 * ====================================================================== */

export function standardTabActions(tab, { locked = false, onDone, onFavorite, onResetIdle } = {}) {
  if (locked) return [IconButton({ emoji: "locked", label: "卡片已锁定，操作被禁用", size: "xs", disabled: true })];
  const actions = [
    IconButton({ emoji: "bullseye", label: "聚焦此标签", size: "xs", onClick: async (e) => { e.stopPropagation(); await focusTab(tab.id, tab.windowId); onDone?.(); } }),
  ];
  if (featureOn("sleep")) {
    actions.push(
      tab.discarded
        ? IconButton({ emoji: "play-button", label: "唤醒", size: "xs", onClick: async (e) => { e.stopPropagation(); await wakeTabs([tab.id]); onDone?.(); } })
        : tab.isSleepable
          ? IconButton({ emoji: "crescent-moon", label: "休眠", size: "xs", onClick: async (e) => { e.stopPropagation(); await sleepTabs([tab.id]); onDone?.(); } })
          : IconButton({ icon: "moon", iconSize: 16, label: "不可休眠：已固定、受保护或正在使用", size: "xs", disabled: true })
    );
  }
  actions.push(
    IconButton({ icon: "x", iconSize: 16, label: "关闭", size: "xs", onClick: async (e) => { e.stopPropagation(); const r = await closeTabs([tab.id]); if (r.failed.length) toastError("这个标签没能关闭", "浏览器拒绝了关闭请求。"); onDone?.(); } })
  );
  actions.push(
    MenuButton({
      emoji: "gear",
      label: "更多操作",
      size: "xs",
      items: () => [
        { label: "暂存到暂存区", icon: "inbox", onSelect: async () => { await stashTabs([tab], { close: false }); toast({ title: "已加入暂存区" }); onDone?.(); } },
        ...(featureOn("favorites") ? [{ label: "收藏到…", icon: "star", onSelect: () => onFavorite?.([tab]) }] : []),
        { separator: true },
        { label: tab.pinned ? "取消固定" : "固定标签", icon: "pin", onSelect: async () => { await pinTabs([tab.id], !tab.pinned); onDone?.(); } },
        { label: "重置闲置度", icon: "rotate-ccw", onSelect: async () => { await resetIdleFor([tab.url]); onDone?.(); } },
        { separator: true },
        { label: "复制网址", icon: "copy", onSelect: () => copyText(tab.url).then(() => toast({ title: "网址已复制" })) },
      ],
    })
  );
  return actions;
}

export async function openFavoritePicker(tabs, onDone, { asCollection = false } = {}) {
  if (!tabs.length) return;

  const result = await new Promise((resolve) => {
    let collections = listCollections().filter((c) => c.id !== STASH_ID);
    let target = collections[0]?.id || null;
    const list = h("div.col.gap-1");
    const paint = () => {
      clear(list);
      for (const c of collections) {
        append(
          list,
          h(
            "button.menu-item",
            { dataset: { id: c.id, active: String(c.id === target) }, onClick: () => { target = c.id; paint(); } },
            ico("folder", 14),
            h("span.flex-1", c.name),
            h("span.menu-trail", `${(c.items || []).length}`)
          )
        );
      }
      append(list, h("div.menu-sep"));
      append(
        list,
        h(
          "button.menu-item",
          {
            onClick: async () => {
              const name = await promptDialog({ title: "新建收藏区", value: siteOf(tabs[0].url) || "新收藏区" });
              if (!name) return;
              const col = await createCollection(name);
              dialogRef?.close(col.id);
            },
          },
          ico("folder-plus", 14),
          h("span.flex-1", "新建收藏区…")
        )
      );
    };
    paint();

    let dialogRef = null;
    dialogRef = openDialog({
      title: asCollection ? "收藏整个窗口到…" : `收藏 ${tabs.length} 个标签到…`,
      description: "收藏后标签仍保留在原处，可随时从收藏区打开。",
      size: "sm",
      body: list,
      footer: h(
        "div.row.gap-2",
        { style: { width: "100%", justifyContent: "flex-end" } },
        Button({ label: "取消", variant: "ghost", onClick: () => dialogRef?.close(null) }),
        Button({ label: "收藏", variant: "primary", onClick: () => dialogRef?.close(target) })
      ),
      onClose: (v) => resolve(v ?? null),
    });
  });

  if (!result) return;
  await stashTabs(tabs, { collectionId: result, close: false, source: "favorite" });
  toast({ title: `已收藏到「${listCollections().find((c) => c.id === result)?.name}」`, variant: "success" });
  onDone?.();
}

/* ====================================================================== *
 * command palette (⌘K / Ctrl+K)
 * ====================================================================== */

let paletteInstance = null;

export function openPalette({ onPick, onClose, initial = "" } = {}) {
  // The shortcut stays live while the palette's own input has focus, so a
  // second ⌘K has to refocus the open one instead of stacking another overlay.
  if (paletteInstance) {
    paletteInstance.focus();
    return paletteInstance;
  }
  const overlay = h("div.overlay", { style: { background: "hsl(var(--overlay))" } });
  const input = h("input.palette-input", { placeholder: paletteHint(), value: initial, spellcheck: false });
  const list = h("div.palette-list");
  const chipsRow = h("div.row.gap-1-5.wrap", { style: { padding: "6px 12px 2px", display: "none" } });
  const foot = h(
    "div.palette-foot",
    h("span.row.gap-1", h("span.kbd", "↑↓"), "选择"),
    h("span.row.gap-1", h("span.kbd", "↵"), "打开"),
    h("span.row.gap-1", h("span.kbd", "Esc"), "关闭"),
    h("span.flex-1"),
    h("span", { id: "palette-count" })
  );

  const box = h(
    "div.palette",
    { role: "dialog", "aria-modal": "true", "aria-label": "统一搜索" },
    h("div.palette-input-row", ico("search", 17), input, h("span.kbd", "Esc")),
    chipsRow,
    list,
    foot
  );

  let results = { groups: {}, flat: [] };
  let activeIndex = 0;
  let flat = [];
  const anchors = new Map();
  // data-idx follows grouped render order while results.flat is score-sorted,
  // so jumping by source has to look up the index the DOM was built with.
  const groupStart = new Map();

  const jumpTo = (source) => {
    const target = anchors.get(source);
    if (!target) return;
    // scrollIntoView mis-scrolls sticky labels, so scroll the list by hand
    const top = target.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop - 4;
    list.scrollTo({ top: Math.max(0, top), behavior: document.hidden ? "auto" : "smooth" });
    const idx = groupStart.get(source);
    if (idx != null) setActive(idx);
  };

  const renderEmpty = () => {
    clear(list);
    anchors.clear();
    groupStart.clear();
    chipsRow.style.display = "none";
    clear(chipsRow);
    const recent = recentSearches();
    const frequent = frequentSearches();
    if (!recent.length && !frequent.length) {
      append(
        list,
        h("div.empty", { style: { padding: "24px 16px" } }, h("div.empty-icon", ico("search", 18)), h("div.empty-title", "输入关键词开始搜索"), h("div.empty-desc", "支持标签标题、网址、书签、历史记录与最近关闭的页面。"))
      );
      return;
    }
    if (recent.length) {
      append(list, h("div.palette-group-label", ico("history", 12), "最近搜索"));
      for (const term of recent.slice(0, 6)) {
        append(
          list,
          h(
            "div.palette-item",
            { onClick: () => { input.value = term; run(term); input.focus(); } },
            ico("corner-down-right", 14),
            h("span.palette-title", term)
          )
        );
      }
    }
    if (frequent.length) {
      append(list, h("div.palette-group-label", ico("flame", 12), "高频搜索"));
      const row = h("div.chip-row", { style: { padding: "4px 8px 8px" } });
      for (const f of frequent.slice(0, 8)) {
        append(
          row,
          h("button.chip", { onClick: () => { input.value = f.term; run(f.term); input.focus(); } }, f.term, h("span.muted", `×${f.count}`))
        );
      }
      append(list, row);
    }
    flat = [];
  };

  const renderResults = () => {
    clear(list);
    anchors.clear();
    groupStart.clear();
    // results.flat is score-sorted; the palette renders grouped by source, so
    // the array that Enter/↑/↓ index has to be rebuilt in render order.
    const total = (results.flat || []).length;
    activeIndex = Math.min(activeIndex, Math.max(0, total - 1));

    clear(chipsRow);
    if (total) {
      chipsRow.style.display = "";
      append(
        chipsRow,
        h("span.muted.text-xs", `${total} 条结果：`),
        ...Object.entries(results.counts || {})
          .filter(([, n]) => n > 0)
          .map(([source, n]) =>
            h(
              "button.chip",
              { title: `跳到「${SOURCE_LABEL[source]}」`, "data-tip": `跳到「${SOURCE_LABEL[source]}」`, onClick: () => jumpTo(source) },
              SOURCE_LABEL[source],
              h("span.muted", ` ${n}`)
            )
          )
      );
    } else {
      chipsRow.style.display = "none";
    }

    if (!total) {
      append(list, h("div.empty", { style: { padding: "24px 16px" } }, h("div.empty-icon", ico("search", 18)), h("div.empty-title", `没有匹配「${results.query}」的结果`), h("div.empty-desc", "换个关键词，或检查搜索范围设置。")));
      flat = [];
      return;
    }
    const ordered = [];
    let cursor = 0;
    for (const source of availableSources().map((s) => s.id)) {
      const items = results.groups[source] || [];
      if (!items.length) continue;
      const label = h("div.palette-group-label.sticky-label", ico(sourceIcon(source), 12), SOURCE_LABEL[source], h("span.muted", ` ${items.length}`));
      anchors.set(source, label);
      groupStart.set(source, cursor);
      const groupWrap = h("div.col.gap-0-5", label);
      for (const item of items) {
        const idx = cursor++;
        ordered.push(item);
        append(
          groupWrap,
          h(
            "div.palette-item",
            {
              dataset: { idx: String(idx) },
              onClick: () => pick(item),
              onMouseEnter: () => setActive(idx),
            },
            item.favicon ? Favicon({ url: item.url }) : ico(sourceIcon(source), 15),
            h(
              "div.col.flex-1.min-h-0",
              h("div.palette-title", { marks: { text: item.title, query: results.query } }),
              h("div.palette-meta", { marks: { text: item.meta || item.url, query: results.query } })
            ),
            h("span.badge.badge-outline", sourceBadge(source))
          )
        );
      }
      append(list, groupWrap);
    }
    flat = ordered;
    setActive(activeIndex);
  };

  const setActive = (idx) => {
    activeIndex = idx;
    for (const node of list.querySelectorAll(".palette-item[data-idx]")) {
      node.dataset.active = String(Number(node.dataset.idx) === idx);
    }
    const node = list.querySelector(`.palette-item[data-idx="${idx}"]`);
    node?.scrollIntoView({ block: "nearest" });
    const count = foot.querySelector("#palette-count");
    if (count) count.textContent = flat.length ? `${idx + 1} / ${flat.length}` : "";
  };

  const pick = (item) => {
    recordSearch(results.query);
    close();
    onPick?.(item);
  };

  const run = debounce(async (q) => {
    if (!q.trim()) {
      renderEmpty();
      return;
    }
    results = await unifiedSearch(q);
    renderResults();
  }, 120);

  input.addEventListener("input", () => {
    activeIndex = 0;
    run(input.value);
  });

  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (flat.length) setActive((activeIndex + 1) % flat.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length) setActive((activeIndex - 1 + flat.length) % flat.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[activeIndex];
      if (item) pick(item);
    }
  };

  const close = () => {
    paletteInstance = null;
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    box.remove();
    onClose?.();
  };

  overlay.addEventListener("click", close);
  document.body.appendChild(overlay);
  document.body.appendChild(box);
  document.addEventListener("keydown", onKey, true);
  renderEmpty();
  if (initial) run(initial);
  setTimeout(() => input.focus(), 20);

  paletteInstance = { close, focus: () => input.focus() };
  return paletteInstance;
}

function sourceIcon(source) {
  return { tab: "app-window", stash: "layers", bookmark: "bookmark", history: "history", closed: "rotate-ccw" }[source] || "circle";
}
function sourceBadge(source) {
  return { tab: "标签", stash: "暂存", bookmark: "书签", history: "历史", closed: "已关闭" }[source] || source;
}

/* ====================================================================== *
 * live tab subscription
 * ====================================================================== */

export function onTabsChanged(handler, { debounceMs = 160 } = {}) {
  const debounced = debounce(handler, debounceMs);
  const events = [
    chrome.tabs.onCreated,
    chrome.tabs.onRemoved,
    chrome.tabs.onUpdated,
    chrome.tabs.onMoved,
    chrome.tabs.onActivated,
    chrome.tabs.onAttached,
    chrome.tabs.onDetached,
    chrome.windows.onCreated,
    chrome.windows.onRemoved,
    chrome.windows.onFocusChanged,
    chrome.tabGroups.onCreated,
    chrome.tabGroups.onUpdated,
    chrome.tabGroups.onRemoved,
  ].filter(Boolean);
  for (const ev of events) ev.addListener(debounced);
  return () => {
    for (const ev of events) ev.removeListener(debounced);
  };
}

export function onStorageChanged(handler) {
  const wrapped = debounce(() => handler(), 120);
  return store.onAny(wrapped);
}

/* ====================================================================== *
 * shared dialogs
 * ====================================================================== */

export function confirmDanger({ title, description, confirmLabel = "删除", body }) {
  return confirmDialog({ title, description, confirmLabel, danger: true, body });
}

export function toastError(message, detail) {
  return toast({ title: "出错了", description: detail ? `${message}：${detail}` : message, variant: "destructive", duration: 6000 });
}
