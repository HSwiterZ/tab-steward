import { h, ico, clear, append, toast, IconButton, Button, hotkeys } from "../ui/kit.js";
import { openPalette, onTabsChanged, onStorageChanged, toastError, bootPage, featureOn, paletteHint } from "../ui/shared.js";
import { store } from "../core/storage.js";
import { MOD_KEY } from "../core/utils.js";
import { dueReminders, gotoReminder, snoozeReminder, markDone } from "../core/reminders.js";
import { switchToTab, closeAndSwitch } from "../core/dupes.js";
import { renderTabsView, renderAnalytics } from "./views-tabs.js";
import { renderCollectionsPanel, renderLibrary, renderReminders, renderSnapshots, renderData } from "./views-data.js";

const VIEWS = {
  tabs: { render: renderTabsView, icon: "app-window", label: "当前标签", desc: "" },
  reminders: { render: renderReminders, icon: "bell", label: "提醒", desc: "到点通过系统通知、扩展角标与 Dashboard 横幅提醒你。" },
  snapshots: { render: renderSnapshots, icon: "package", label: "工作区快照", desc: "保存窗口布局与标签顺序，随时一键恢复。" },
  analytics: { render: renderAnalytics, icon: "bar-chart", label: "使用分析", desc: "前台停留时长、激活次数与闲置度统计。" },
  data: { render: renderData, icon: "database", label: "回收站与备份", desc: "删除的内容保留 30 天；备份可导出为 JSON。" },
};

const NAV_ORDER = ["reminders", "snapshots", "analytics", "data"];

/** Which module owns each nav entry — a disabled module removes its icon. */
const VIEW_MODULE = { reminders: "reminders", snapshots: "snapshots", data: "trash" };
const viewVisible = (id) => !VIEW_MODULE[id] || featureOn(VIEW_MODULE[id]);

const app = {
  view: "tabs",
  scroll: null,
  navButtons: new Map(),
  subEl: null,
  banner: null,
  panel: null,
  counts: {},
};

export function navigate(view) {
  if (!VIEWS[view] || !viewVisible(view)) return;
  app.view = view;
  location.hash = view;
  renderView();
}

export function refreshView() {
  renderView();
}

let viewCleanup = null;

async function renderView() {
  viewCleanup?.();
  viewCleanup = null;
  clear(app.scroll);

  for (const [id, btn] of app.navButtons) {
    btn.setAttribute("aria-pressed", String(id === app.view));
  }

  const meta = VIEWS[app.view];
  if (app.view !== "tabs") {
    append(
      app.scroll,
      h(
        "div.view-head",
        h("div.row.gap-2", ico(meta.icon, 17), h("div.text-lg.font-semibold", meta.label)),
        meta.desc ? h("div.muted.text-xs", meta.desc) : null
      )
    );
  }

  const ctx = {
    el: app.scroll,
    navigate,
    refresh: refreshView,
    openPalette: (opts) => openPalette({ ...opts, onPick: handlePick }),
    toast,
    toastError,
    app,
  };
  try {
    const node = await meta.render(ctx);
    append(app.scroll, node);
  } catch (err) {
    console.error(`[dashboard] view ${app.view} failed`, err);
    append(app.scroll, h("div.empty", h("div.empty-icon", ico("circle-alert", 18)), h("div.empty-title", "这个视图出错了"), h("div.empty-desc", String(err?.message || err))));
  }
}

/* ====================================================================== *
 * counts + reminder banner
 * ====================================================================== */

async function recount() {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  const windows = await chrome.windows.getAll({}).catch(() => []);
  const collections = store.get("collections") || [];
  app.counts = {
    tabs: tabs.length,
    sites: new Set(tabs.map((t) => { try { return new URL(t.url).hostname.replace(/^www\./, ""); } catch { return t.url; } })).size,
    windows: windows.filter((w) => w.type === "normal").length,
    items: collections.reduce((s, c) => s + (c.items || []).length, 0),
    due: dueReminders().length,
    reminders: (store.get("reminders") || []).filter((r) => r.status === "pending").length,
    snapshots: (store.get("snapshots") || []).length,
    trash: (store.get("trash") || []).length,
  };
  // A disabled module reports nothing, so its nav badge cannot linger on zero-visibility counts.
  if (!featureOn("reminders")) {
    app.counts.due = 0;
    app.counts.reminders = 0;
  }
  if (!featureOn("snapshots")) app.counts.snapshots = 0;
  if (!featureOn("trash")) app.counts.trash = 0;
  if (app.subEl) app.subEl.textContent = `${app.counts.tabs} 个标签 · ${app.counts.sites} 个站点 · ${app.counts.windows} 个窗口`;
  for (const id of NAV_ORDER) {
    const btn = app.navButtons.get(id);
    const badge = btn?.querySelector(".nav-dot");
    if (!badge) continue;
    const n = { reminders: app.counts.due || app.counts.reminders, snapshots: app.counts.snapshots, data: app.counts.trash }[id] || 0;
    badge.textContent = n ? String(n) : "";
    badge.style.display = n ? "" : "none";
  }
  renderBanner();
}

function renderBanner() {
  const due = dueReminders();
  const settings = store.get("settings") || {};
  if (!featureOn("reminders") || !due.length || settings.reminders?.dashboardBanner === false) {
    app.banner.classList.add("hidden");
    clear(app.banner);
    return;
  }
  clear(app.banner);
  append(
    app.banner,
    ico("bell-ring", 15),
    h("span.flex-1", `有 ${due.length} 条提醒已到时：${due[0].note || due[0].title}`),
    Button({ label: "打开", size: "xs", variant: "outline", onClick: () => gotoReminder(due[0]) }),
    Button({ label: "续时 10 分钟", size: "xs", variant: "ghost", onClick: async () => { await snoozeReminder(due[0].id, 10); recount(); } }),
    Button({ label: "完成", size: "xs", variant: "ghost", onClick: async () => { await markDone(due[0].id); recount(); } })
  );
  app.banner.classList.remove("hidden");
}

/* ====================================================================== *
 * shell
 * ====================================================================== */

function navButton(id) {
  const meta = VIEWS[id];
  const btn = h(
    "button.nav-icon",
    {
      dataset: { view: id },
      title: meta.label,
      "data-tip": meta.label,
      "aria-pressed": "false",
      onClick: () => navigate(app.view === id ? "tabs" : id),
    },
    ico(meta.icon, 16),
    h("span.nav-dot")
  );
  app.navButtons.set(id, btn);
  return btn;
}

/** Hide the icons of disabled modules and leave a view that just got switched off. */
function applyModuleVisibility() {
  for (const id of NAV_ORDER) app.navButtons.get(id)?.classList.toggle("hidden", !viewVisible(id));
  const hint = document.querySelector(".search-hint");
  if (hint) hint.textContent = paletteHint();
  if (!viewVisible(app.view)) navigate("tabs");
}

function buildShell() {
  app.subEl = h("div.topbar-sub");

  const searchTrigger = h(
    "button.search-trigger.app-search",
    { onClick: () => openPalette({ onPick: handlePick }) },
    ico("search", 15),
    h("span.search-hint", paletteHint()),
    h("span.kbd", `${MOD_KEY} K`)
  );

  const themeButton = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    const b = IconButton({ icon: dark ? "moon" : "sun", label: "切换主题", onClick: () => store.patch("settings", { theme: dark ? "light" : "dark" }) });
    b.dataset.themeToggle = "true";
    return b;
  };

  const header = h(
    "header.app-header",
    h(
      "div.brand",
      { style: { cursor: "pointer" }, onClick: () => navigate("tabs"), title: "回到当前标签" },
      h("img", { src: chrome.runtime.getURL("assets/icon48.png"), alt: "" }),
      h("div.col", h("div.brand-name", "Tab Steward"), app.subEl)
    ),
    searchTrigger,
    h(
      "div.row.gap-1.shrink-0",
      ...NAV_ORDER.map(navButton),
      h("span.sep-v"),
      themeButton(),
      IconButton({
        icon: "settings",
        label: "设置",
        onClick: () => {
          if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
          else location.href = chrome.runtime.getURL("src/options/index.html");
        },
      })
    )
  );

  store.on("settings", () => {
    const next = themeButton();
    document.querySelector("[data-theme-toggle]")?.replaceWith(next);
    applyModuleVisibility();
  });

  app.banner = h("div.banner.hidden");
  app.scroll = h("div.main-scroll");

  const ctx = { navigate, refresh: refreshView, toast, toastError, app, openPalette: (o) => openPalette({ ...o, onPick: handlePick }) };
  app.panel = renderCollectionsPanel(ctx);

  const bodyGrid = h("div.app-body", h("div.main-col", app.scroll), h("div.side-col", app.panel.el));

  document.body.appendChild(h("div.app2", header, app.banner, bodyGrid));
}

/* ====================================================================== *
 * broadcasts
 * ====================================================================== */

function installBroadcasts() {
  const shownReminders = new Set();
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "dupe:found") {
      const v = message.payload;
      toast({
        title: "发现重复标签",
        description: `${v.existing.title || v.existing.url} 在 ${v.location} 已有相同网址的标签`,
        variant: "warning",
        duration: 9000,
        actions: [
          { label: "关闭这个并跳转", onClick: () => closeAndSwitch(v.newTab.id, v.existing.id, v.existing.windowId) },
          { label: "切换过去", onClick: () => switchToTab(v.existing.id, v.existing.windowId) },
        ],
      });
      recount();
    }
    if (message?.type === "reminder:due") {
      const r = message.payload.reminder;
      const key = `${r.id}:${r.firedAt || r.fireAt}`;
      if (shownReminders.has(key)) return;
      shownReminders.add(key);
      toast({ title: r.note || "提醒", description: r.title, variant: "info", duration: 8000 });
      recount();
      if (app.view === "reminders") renderView();
    }
    if (message?.type === "reminder:created") {
      const r = message.payload.reminder;
      toast({
        title: message.payload.armed ? "提醒已创建" : "提醒已创建，但定时器没挂上",
        description: `${r.title} · ${new Date(r.fireAt).toLocaleString()}`,
        variant: message.payload.armed ? "success" : "destructive",
      });
      recount();
      if (app.view === "reminders") renderView();
    }
    if (message?.type === "action:failed") {
      toast({ title: "操作失败", description: message.payload.message, variant: "destructive", duration: 7000 });
    }
    if (message?.type === "sleep:auto") {
      toast({ title: `已自动休眠 ${message.payload.count} 个标签`, duration: 5000 });
      recount();
    }
    if (message?.type === "stash:done") {
      app.panel?.refresh();
    }
    return false;
  });
}

/* ====================================================================== *
 * palette routing
 * ====================================================================== */

async function handlePick(item) {
  try {
    switch (item.source) {
      case "tab":
        await chrome.windows.update(item.payload.windowId, { focused: true }).catch(() => {});
        await chrome.tabs.update(item.payload.tabId, { active: true });
        break;
      case "stash":
        app.panel?.focus(item.payload.collectionId, item.payload.itemId);
        break;
      case "bookmark":
        await chrome.tabs.create({ url: item.url, active: true });
        break;
      case "history":
        if (item.payload.alreadyOpen) {
          const tabs = await chrome.tabs.query({ url: item.url });
          if (tabs.length) {
            await chrome.windows.update(tabs[0].windowId, { focused: true }).catch(() => {});
            await chrome.tabs.update(tabs[0].id, { active: true });
            break;
          }
        }
        await chrome.tabs.create({ url: item.url, active: true });
        break;
      case "closed":
        await chrome.sessions.restore(item.payload.sessionId);
        break;
    }
  } catch (err) {
    toastError("打开失败", err?.message);
  }
}

/* ====================================================================== *
 * boot
 * ====================================================================== */

bootPage(async () => {
  buildShell();
  applyModuleVisibility();
  installBroadcasts();

  const initial = (location.hash || "#tabs").slice(1).split(":")[0];
  app.view = VIEWS[initial] ? initial : "tabs";

  hotkeys({
    "mod+k": (e) => {
      e.preventDefault();
      openPalette({ onPick: handlePick });
    },
    escape: () => {},
  });

  onTabsChanged(() => {
    recount();
    if (app.view === "tabs") renderView();
  });
  onStorageChanged(() => {
    recount();
    app.panel?.refresh();
    renderView();
  });

  await recount();
  await renderView();

  const params = new URLSearchParams(location.search);
  if (params.get("focus") === "search") openPalette({ onPick: handlePick });
  if (params.get("reminder")) {
    app.prefillReminder = decodeURIComponent(params.get("reminder"));
    navigate("reminders");
  }
});

export { app };
