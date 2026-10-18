import { h, ico, clear, append, toast, Button, MenuButton, Badge, Tabs, Switch, Checkbox, Empty, confirmDialog, promptDialog } from "../ui/kit.js";
import { TabRow, SiteCard, Favicon, IdleBadge, toastError, standardTabActions, openFavoritePicker, featureOn } from "../ui/shared.js";
import { store } from "../core/storage.js";
import { SORTS } from "../core/defaults.js";
import { enrichTabs, buildSiteCards, sortSites, resetIdleFor } from "../core/stats.js";
import {
  focusTab,
  closeTabs,
  sleepTabs,
  moveTabsToNewWindow,
  pinSite,
  protectSite,
  setCardLocked,
  isCardLocked,
  windowLabel,
  windowOrdinals,
  closeWindow,
  nameWindow,
  setWindowCollapsed,
} from "../core/actions.js";
import { stashTabs, listCollections, createCollection } from "../core/collections.js";
import { arrangeBySite, arrangeAllWindows, applyCollectionsAsGroups, buildSuggestions, ungroupWindow } from "../core/organize.js";
import { markDuplicates, closeDuplicates, restoreClosed } from "../core/dupes.js";
import { analyticsSummary } from "../background/tracker.js";
import { formatDuration, formatRelative, siteOf } from "../core/utils.js";

const viewSettings = () => (store.get("settings") || {}).view || {};
const patchView = (patch) => store.patch("settings", { view: { ...viewSettings(), ...patch } });

/* ====================================================================== *
 * shared loader
 * ====================================================================== */

async function loadWorld() {
  const [rawTabs, windows, groups] = await Promise.all([
    chrome.tabs.query({}),
    chrome.windows.getAll({}),
    chrome.tabGroups.query({}).catch(() => []),
  ]);
  const tabs = enrichTabs(rawTabs);
  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const storedWindows = store.get("windows") || {};
  const ordinals = windowOrdinals(windows);
  const windowMap = new Map(windows.map((w) => [w.id, { ...w, label: windowLabel(w, storedWindows[w.id], ordinals.get(w.id)), stored: storedWindows[w.id] || {} }]));

  // duplicate marks
  const { marks } = await markDuplicates({});
  for (const tab of tabs) {
    const m = marks.get(tab.id);
    tab.dupeCount = m && !m.isKeeper ? m.count - 1 : 0;
    tab.isDupeKeeper = !!m?.isKeeper;
  }

  const locked = new Set(store.get("lockedCards") || []);
  const cards = buildSiteCards(tabs);
  for (const card of cards) {
    card.locked = locked.has(card.site);
    card.tabs.forEach((t) => (t.cardLocked = card.locked));
  }
  return { tabs, windows, groups, groupMap, windowMap, cards };
}

/* ====================================================================== *
 * overview
 * ====================================================================== */

export async function renderOverview(ctx) {
  const world = await loadWorld();
  const suggestions = await buildSuggestions({});
  const stats = store.get("stats") || {};
  const sleeping = world.tabs.filter((t) => t.discarded).length;
  const audible = world.tabs.filter((t) => t.audible).length;
  const dupes = world.tabs.filter((t) => t.dupeCount > 0).length;
  const totalForeground = Object.values(stats).reduce((s, e) => s + (e.foregroundMs || 0), 0);
  const reminders = (store.get("reminders") || []).filter((r) => r.status === "pending");

  const stat = (label, value, hint, icon) =>
    h("div.stat-card", h("div.stat-label", ico(icon, 12), label), h("div.stat-value", value), hint ? h("div.stat-hint", hint) : null);

  const quick = (label, icon, onClick, variant = "outline") => Button({ label, icon, onClick, variant, size: "sm" });

  const suggestionCards = suggestions.length
    ? suggestions.map((s) =>
        h(
          "div.suggestion",
          h("div.suggestion-icon", ico(s.icon, 15)),
          h("div.col.flex-1.gap-1", h("div.suggestion-title", s.title), h("div.suggestion-detail", s.detail)),
          Badge({ label: String(s.count), variant: "secondary" }),
          Button({
            label: "处理",
            size: "xs",
            onClick: async () => {
              await runSuggestion(s);
              ctx.refresh();
            },
          })
        )
      )
    : [h("div.empty", h("div.empty-icon", ico("circle-check", 18)), h("div.empty-title", "暂时没有需要整理的地方"), h("div.empty-desc", "标签都很健康。等出现重复、闲置或分散时，这里会给出建议。"))];

  return h(
    "div.col.gap-4",
    h(
      "div.stat-grid",
      stat("打开的标签", String(world.tabs.length), `${world.windows.filter((w) => w.type === "normal").length} 个普通窗口`, "app-window"),
      stat("已休眠", String(sleeping), "释放了渲染进程内存", "moon"),
      stat("正在播放", String(audible), audible ? "这些不会被自动休眠" : "当前没有声音", "volume"),
      stat("重复标签", String(dupes), dupes ? "点击标签视图可一键清理" : "没有重复", "copy"),
      stat("累计前台时长", formatDuration(totalForeground), "按网址累计", "timer"),
      stat("待办提醒", String(reminders.length), reminders.length ? `最近：${formatRelative(Math.min(...reminders.map((r) => r.fireAt)))}` : "暂无", "bell")
    ),
    h("div.col.gap-2", h("div.section-title", ico("lightbulb", 14), "整理建议"), ...suggestionCards),
    h(
      "div.col.gap-2",
      h("div.section-title", ico("zap", 14), "快捷操作"),
      h(
        "div.row.gap-2.wrap",
        quick("整理同站点标签", "sort-asc", async () => {
          const res = await arrangeBySite((await chrome.windows.getLastFocused({})).id);
          toast({ title: `已整理 ${res.moved} 个标签`, description: `${res.sites} 个站点现在各自相邻` });
          ctx.refresh();
        }),
        quick("按收藏区分组", "layers", async () => {
          const res = await applyCollectionsAsGroups(null);
          toast({ title: `新建 ${res.created} 个分组，合并 ${res.merged} 个标签` });
          ctx.refresh();
        }),
        quick("清理重复标签", "copy", async () => {
          const res = await closeDuplicates({ keep: "active" });
          if (!res.closed) return toast({ title: "没有重复标签", variant: "info" });
          toast({
            title: `已关闭 ${res.closed} 个重复标签`,
            variant: "success",
            actions: [{ label: "撤销", onClick: () => restoreClosed(res.closedTabs) }],
          });
          ctx.refresh();
        }),
        quick("休眠全部闲置", "moon", async () => {
          const idle = world.tabs.filter((t) => t.isSleepable && t.idleMs > 60 * 60_000);
          const res = await sleepTabs(idle.map((t) => t.id));
          toast({ title: `已休眠 ${res.slept} 个标签`, description: res.skipped.length ? `${res.skipped.length} 个被跳过` : "" });
          ctx.refresh();
        }),
        quick("保存工作区快照", "package", async () => {
          const { captureSnapshot } = await import("../core/snapshots.js");
          const snap = await captureSnapshot({ scope: "all" });
          toast({ title: "快照已保存", description: snap.name, variant: "success" });
          ctx.navigate("snapshots");
        })
      )
    )
  );
}

async function runSuggestion(s) {
  const payload = s.action.payload || {};
  switch (s.action.type) {
    case "dedupe.all": {
      const res = await closeDuplicates({ keep: payload.keep || "active" });
      toast({ title: `已关闭 ${res.closed} 个重复标签`, variant: "success", actions: [{ label: "撤销", onClick: () => restoreClosed(res.closedTabs) }] });
      break;
    }
    case "sleep.tabs": {
      const res = await sleepTabs(payload.tabIds);
      toast({ title: `已休眠 ${res.slept} 个标签` });
      break;
    }
    case "organize.arrange": {
      const res = await arrangeBySite((await chrome.windows.getLastFocused({})).id);
      toast({ title: `已整理 ${res.moved} 个标签` });
      break;
    }
    case "organize.groups": {
      const res = await applyCollectionsAsGroups(null);
      toast({ title: `新建 ${res.created} 个分组` });
      break;
    }
  }
}

/* ====================================================================== *
 * tabs view
 * ====================================================================== */

export async function renderTabsView(ctx) {
  let state = {
    sort: viewSettings().sort || "idle",
    groupByWindow: viewSettings().groupBySite !== false,
    filter: viewSettings().filter || "all",
    idleThresholdMinutes: viewSettings().idleThresholdMinutes ?? 60,
    expandedSites: new Set(viewSettings().expandedSites || []),
    collapsedWindows: new Set(viewSettings().collapsedWindows || []),
  };
  const selected = new Set();

  const body = h("div.col.gap-4");
  const batchBar = h("div.batchbar.hidden");
  const chipsRow = h("div.filter-chips");
  const countLabel = h("span.muted.text-xs");

  const toolbar = h(
    "div.view-toolbar",
    h("span.toolbar-label", "排序"),
    Tabs({
      items: SORTS.map((s) => ({ id: s.id, label: s.label, hint: s.hint })),
      value: state.sort,
      onChange: (v) => {
        state.sort = v;
        patchView({ sort: v });
        render();
      },
    }),
    h("span.sep-v"),
    h(
      "label.row.gap-1-5.cursor-pointer",
      { style: { fontSize: "12.5px" } },
      Switch({
        checked: state.groupByWindow,
        label: "按窗口分组",
        onChange: (on) => {
          state.groupByWindow = on;
          patchView({ groupBySite: on });
          render();
        },
      }),
      "按窗口分组"
    ),
    h("span.flex-1"),
    countLabel,
    ...(featureOn("organize")
      ? [
          MenuButton({
            icon: "wand",
            label: "自动整理",
            variant: "outline",
            size: "sm",
            items: () => [
              { label: "当前窗口：同站点相邻", icon: "sort-asc", onSelect: async () => { const r = await arrangeBySite(await currentWindowId()); toast({ title: `已整理 ${r.moved} 个标签` }); render(); } },
              { label: "所有窗口：同站点相邻", icon: "sort-asc", onSelect: async () => { const rs = await arrangeAllWindows(); toast({ title: `已整理 ${rs.reduce((s, r) => s + r.moved, 0)} 个标签` }); render(); } },
              { separator: true },
              { label: "按收藏区创建/合并标签组", icon: "layers", onSelect: async () => { const r = await applyCollectionsAsGroups(null); toast({ title: `新建 ${r.created} 组 · 合并 ${r.merged} 个标签` }); render(); } },
              { label: "解散当前窗口所有分组", icon: "split", onSelect: async () => { const r = await ungroupWindow(await currentWindowId()); toast({ title: `已解散 ${r.ungrouped} 个标签的分组` }); render(); } },
            ],
          }),
        ]
      : []),
    ...(featureOn("duplicates")
      ? [
          Button({
            label: "清理重复",
            icon: "copy",
            variant: "outline",
            size: "sm",
            onClick: async () => {
              const res = await closeDuplicates({ keep: "active" });
              if (!res.closed) return toast({ title: "没有重复标签", variant: "info" });
              toast({ title: `已关闭 ${res.closed} 个重复标签`, description: res.failed.length ? `${res.failed.length} 个未能关闭` : "", variant: res.failed.length ? "warning" : "success", actions: [{ label: "撤销", onClick: () => restoreClosed(res.closedTabs) }] });
              render();
            },
          }),
        ]
      : []),
    ...(featureOn("llm")
      ? [Button({ label: "让助手整理", icon: "sparkles", variant: "outline", size: "sm", onClick: () => runAssistant() })]
      : [])
  );

  const wrap = h("div.col", toolbar, chipsRow, batchBar, h("div.view-body", body));

  async function currentWindowId() {
    return (await chrome.windows.getLastFocused({})).id;
  }

  /**
   * Ask the configured model for a plan, show it, and only then apply. Nothing
   * is applied without the confirm, and a refusal always says why.
   */
  async function runAssistant() {
    const windowId = await currentWindowId();
    const tabs = await chrome.tabs.query({ windowId });
    if (tabs.length < 2) return toast({ title: "当前窗口标签太少，不必整理", variant: "info" });

    toast({ title: "正在向助手请求方案…", variant: "info", duration: 2500 });
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: "llm:request", payload: { tabs, goal: "" } });
    } catch (err) {
      return toastError("请求发送失败", String(err?.message || err));
    }
    if (!res) return toastError("后台没有响应", "服务 worker 可能正在启动，稍后再试一次。");
    if (res.__error) return toastError("助手请求失败", res.__error);
    if (!res.ok) return toastError("助手没有给出可用方案", `${res.error || "未知原因"}${res.hint ? `｜${res.hint}` : ""}`);

    const plan = res.plan;
    const ok = await confirmDialog({
      title: "助手方案预览",
      description: plan.summary || "按主题分组，并休眠它认为闲置的标签。标签不会被删除。",
      body: h(
        "div.col.gap-1",
        ...plan.groups.map((g) => h("div.row.gap-1.text-xs", Badge({ label: g.name, variant: "secondary" }), h("span.muted", `${g.tabs.length} 个标签${g.reason ? ` · ${g.reason}` : ""}`))),
        plan.sleep.indexes.length ? h("div.text-xs", `休眠 ${plan.sleep.indexes.length} 个标签${plan.sleep.reason ? ` · ${plan.sleep.reason}` : ""}`) : null,
        plan.unassigned.length ? h("div.muted.text-xs", `${plan.unassigned.length} 个标签保持原样`) : null
      ),
      confirmLabel: "应用方案",
    });
    if (!ok) return toast({ title: "已取消，未做任何改动" });

    const applied = await chrome.runtime.sendMessage({ type: "llm:apply", payload: { plan } });
    if (!applied) return toastError("应用失败", "服务 worker 没有响应。");
    if (applied.__error) return toastError("应用失败", applied.__error);
    toast({
      title: `已建 ${applied.groups} 个分组 · 休眠 ${applied.slept} 个`,
      description: [...(applied.errors || []), applied.skipped ? `${applied.skipped} 个不符合休眠条件` : ""].filter(Boolean).join("；"),
      variant: applied.errors?.length ? "warning" : "success",
    });
    render();
  }

  const FILTERS = [
    { id: "all", label: "全部" },
    { id: "idle", label: "闲置" },
    { id: "ungrouped", label: "未分组" },
    ...(featureOn("duplicates") ? [{ id: "dupes", label: "重复" }] : []),
  ];

  function renderChips(counts) {
    clear(chipsRow);
    for (const f of FILTERS) {
      append(
        chipsRow,
        h(
          "button.chip",
          {
            "aria-pressed": String(state.filter === f.id),
            onClick: () => {
              state.filter = f.id;
              patchView({ filter: f.id });
              render();
            },
          },
          f.label,
          h("span.muted", ` · ${counts[f.id]}`)
        )
      );
    }
  }

  function filterTabs(tabs) {
    if (state.filter === "idle") return tabs.filter((t) => !t.active && t.idleMs >= state.idleThresholdMinutes * 60_000);
    if (state.filter === "ungrouped") return tabs.filter((t) => t.groupId === -1);
    if (state.filter === "dupes") return featureOn("duplicates") ? tabs.filter((t) => t.dupeCount > 0 || t.isDupeKeeper) : tabs;
    return tabs;
  }

  function tabActions(tab) {
    return standardTabActions(tab, {
      locked: tab.cardLocked,
      onDone: render,
      onFavorite: (tabs) => openFavoritePicker(tabs, render),
    });
  }

  function cardMenu(card) {
    if (card.locked) {
      return [
        { label: "解锁卡片", icon: "unlock", onSelect: async () => { await setCardLocked(card.site, false); render(); } },
        { label: "锁定会禁用关闭、休眠、暂存等操作", disabled: true },
      ];
    }
    return [
      { label: "展开/收起", icon: "chevrons-up-down", onSelect: () => toggleSite(card.site) },
      { label: "聚焦第一个标签", icon: "crosshair", onSelect: () => focusTab(card.tabs[0].id, card.tabs[0].windowId) },
      { separator: true },
      ...(featureOn("sleep")
        ? [{ label: "整组休眠", icon: "moon", onSelect: async () => { const r = await sleepTabs(card.tabs.map((t) => t.id)); toast({ title: `已休眠 ${r.slept} 个`, description: r.skipped.length ? `${r.skipped.length} 个不符合休眠条件（使用中 / 已固定 / 受保护）` : "" }); render(); } }]
        : []),
      { label: "整组暂存", icon: "inbox", onSelect: async () => { await stashTabs(card.tabs, { close: false }); toast({ title: `已暂存 ${card.tabs.length} 个` }); render(); } },
      ...(featureOn("favorites") ? [{ label: "整组收藏到…", icon: "star", onSelect: () => openFavoritePicker(card.tabs, render) }] : []),
      { label: "整组移至新窗口", icon: "app-window", onSelect: async () => { await moveTabsToNewWindow(card.tabs.map((t) => t.id)); render(); } },
      { separator: true },
      { label: card.pinnedSite ? "取消站点置顶" : "站点置顶", icon: "pin", onSelect: async () => { await pinSite(card.host, !card.pinnedSite); render(); } },
      ...(featureOn("sleep")
        ? [{ label: card.protectedSite ? "取消站点保护" : "保护站点（不自动休眠）", icon: "shield-check", onSelect: async () => { await protectSite(card.host, !card.protectedSite); render(); } }]
        : []),
      { label: "锁定卡片", icon: "lock", onSelect: async () => { await setCardLocked(card.site, true); render(); } },
      { separator: true },
      { label: "重置该站点闲置度", icon: "rotate-ccw", onSelect: async () => { await resetIdleFor(card.tabs.map((t) => t.url)); render(); } },
      { label: "关闭整组", icon: "x", destructive: true, onSelect: async () => {
          const ok = await confirmDialog({ title: `关闭 ${card.site} 的 ${card.tabs.length} 个标签？`, description: "关闭后可在最近关闭中恢复。", confirmLabel: "关闭", danger: true });
          if (!ok) return;
          const r = await closeTabs(card.tabs.map((t) => t.id));
          if (r.failed.length) toastError(`${r.failed.length} 个标签关闭失败`, "Chrome 拒绝了关闭请求，其余标签已关闭。");
          render();
        } },
    ];
  }

  function toggleSite(site) {
    if (state.expandedSites.has(site)) state.expandedSites.delete(site);
    else state.expandedSites.add(site);
    patchView({ expandedSites: [...state.expandedSites] });
    render();
  }

  function updateBatchBar() {
    clear(batchBar);
    if (!selected.size) {
      batchBar.classList.add("hidden");
      return;
    }
    batchBar.classList.remove("hidden");
    const ids = [...selected].map(Number);
    append(
      batchBar,
      Badge({ label: `已选 ${selected.size}`, variant: "primary" }),
      Button({ label: "关闭所选", icon: "x", size: "xs", variant: "destructive", onClick: async () => { const r = await closeTabs(ids); if (r.failed.length) toastError(`${r.failed.length} 个标签关闭失败`, "Chrome 拒绝了关闭请求，其余标签已关闭。"); selected.clear(); render(); } }),
      Button({ label: "休眠所选", icon: "moon", size: "xs", onClick: async () => { const r = await sleepTabs(ids); toast({ title: `已休眠 ${r.slept} 个` }); selected.clear(); render(); } }),
      Button({ label: "暂存所选", icon: "inbox", size: "xs", onClick: async () => { const tabs = await chrome.tabs.query({}); await stashTabs(tabs.filter((t) => selected.has(t.id)), { close: false }); selected.clear(); render(); } }),
      Button({ label: "移至新窗口", icon: "app-window", size: "xs", onClick: async () => { await moveTabsToNewWindow(ids); selected.clear(); render(); } }),
      Button({ label: "收藏到…", icon: "star", size: "xs", variant: "outline", onClick: async () => { const tabs = await chrome.tabs.query({}); openFavoritePicker(tabs.filter((t) => selected.has(t.id)), render); } }),
      h("span.flex-1"),
      Button({ label: "取消选择", size: "xs", variant: "ghost", onClick: () => { selected.clear(); render(); } })
    );
  }

  let world = null;

  async function render() {
    world = await loadWorld();
    const all = world.tabs;
    const counts = {
      all: all.length,
      idle: all.filter((t) => !t.active && t.idleMs >= state.idleThresholdMinutes * 60_000).length,
      ungrouped: all.filter((t) => t.groupId === -1).length,
      dupes: all.filter((t) => t.dupeCount > 0).length,
    };
    renderChips(counts);
    countLabel.textContent = `${new Set(all.map((t) => t.site)).size} 个站点 · ${all.length} 个标签`;

    const tabs = filterTabs(all);
    const cards = buildSiteCards(tabs);
    for (const card of cards) {
      card.locked = isCardLocked(card.site);
      card.tabs.forEach((t) => (t.cardLocked = card.locked));
    }

    const hot = cards.filter((c) => c.avgIdle >= 70 && c.tabs.length >= 2);
    const normal = cards.filter((c) => !hot.includes(c));

    clear(body);

    if (!tabs.length) {
      append(body, Empty({ icon: "app-window", title: "没有符合条件的标签", desc: "换个筛选条件试试。" }));
      updateBatchBar();
      return;
    }

    if (hot.length) append(body, renderIdleBucket(hot));

    const sortedCards = sortSites(normal, state.sort);
    const pinnedFirst = [...sortedCards.filter((c) => c.pinnedSite), ...sortedCards.filter((c) => !c.pinnedSite)];

    if (!state.groupByWindow) {
      append(body, h("div.site-grid", ...pinnedFirst.map((c) => renderCard(c))));
    } else {
      for (const w of world.windows.filter((x) => tabs.some((t) => t.windowId === x.id))) {
        const winTabs = tabs.filter((t) => t.windowId === w.id);
        const winCards = buildSiteCards(winTabs);
        for (const c of winCards) {
          c.locked = isCardLocked(c.site);
          c.tabs.forEach((t) => (t.cardLocked = c.locked));
        }
        append(body, renderWindowSection(w, sortSites(winCards, state.sort), true));
      }
    }

    updateBatchBar();
  }



  function renderCard(card) {
    return SiteCard(card, {
      expanded: state.expandedSites.has(card.site),
      onToggle: toggleSite,
      cardMenu,
      tabActions,
      onOpenTab: (tab) => focusTab(tab.id, tab.windowId),
      groups: world.groupMap,
      windowLabels: new Map([...world.windowMap].map(([id, w]) => [id, w.label])),
      selectedIds: selected,
      checkboxFor: (tab) =>
        Checkbox({
          checked: selected.has(tab.id),
          label: `选择 ${tab.title}`,
          onChange: (on) => {
            if (on) selected.add(tab.id);
            else selected.delete(tab.id);
            updateBatchBar();
          },
        }),
    });
  }

  function renderWindowSection(win, cardsOrTabs, isCards) {
    const info = world.windowMap.get(win.id);
    const collapsed = state.collapsedWindows.has(win.id);
    const tabCount = isCards ? cardsOrTabs.reduce((s, c) => s + c.tabs.length, 0) : cardsOrTabs.length;

    const section = h(
      "div.window-section",
      h(
        "div.window-head",
        {
          onClick: (e) => {
            if (e.target.closest("button")) return;
            if (collapsed) state.collapsedWindows.delete(win.id);
            else state.collapsedWindows.add(win.id);
            patchView({ collapsedWindows: [...state.collapsedWindows] });
            render();
          },
        },
        ico(collapsed ? "chevron-right" : "chevron-down", 14, "collapse-chevron"),
        ico("app-window", 14),
        h("span.window-name", info.label),
        win.focused ? Badge({ label: "当前", variant: "success" }) : null,
        h("span.window-meta", `${tabCount} 个标签${info.tabs ? "" : ""}`),
        h("span.flex-1"),
        MenuButton({
          icon: "ellipsis",
          label: "窗口操作",
          size: "xs",
          items: () => [
            { label: "聚焦窗口", icon: "crosshair", onSelect: () => chrome.windows.update(win.id, { focused: true }) },
            { label: "重命名窗口", icon: "pencil", onSelect: async () => {
                const name = await promptDialog({ title: "窗口名称", value: info.stored?.name || "", placeholder: "例如：写作 / 调研" });
                if (name == null) return;
                await nameWindow(win.id, name);
                render();
              } },
            { label: collapsed ? "展开窗口" : "折叠窗口", icon: collapsed ? "chevron-down" : "chevron-right", onSelect: async () => { await setWindowCollapsed(win.id, !collapsed); render(); } },
            { separator: true },
            { label: "收藏整个窗口", icon: "star", onSelect: async () => {
                const tabs = await chrome.tabs.query({ windowId: win.id });
                openFavoritePicker(tabs, render, { asCollection: true });
              } },
            { label: "收藏后关闭窗口", icon: "archive", onSelect: async () => {
                const tabs = await chrome.tabs.query({ windowId: win.id });
                const col = await createCollection(info.label);
                await stashTabs(tabs, { collectionId: col.id, close: false });
                await closeWindow(win.id);
                toast({ title: `已收藏到「${col.name}」并关闭窗口` });
                render();
              } },
            { separator: true },
            { label: "关闭窗口", icon: "x", destructive: true, onSelect: async () => {
                const ok = await confirmDialog({ title: `关闭「${info.label}」？`, description: `其中 ${tabCount} 个标签会一并关闭。`, confirmLabel: "关闭", danger: true });
                if (!ok) return;
                await closeWindow(win.id);
                render();
              } },
          ],
        })
      ),
      collapsed
        ? null
        : h("div.window-body", isCards ? h("div.site-grid", ...cardsOrTabs.map((c) => renderCard(c))) : cardsOrTabs.map((t) => renderFlatRow(t)))
    );
    return section;
  }


  function renderIdleBucket(hotCards) {
    const allTabs = hotCards.flatMap((c) => c.tabs);
    return h(
      "div.card",
      { style: { borderColor: "hsl(var(--warning) / 0.4)" } },
      h(
        "div.card-header",
        { style: { flexDirection: "row", alignItems: "center", gap: "8px", padding: "10px 14px" } },
        ico("alert-triangle", 15, "shrink-0"),
        h("div.col.flex-1", h("div.card-title", `高闲置站点 · ${hotCards.length} 个`), h("div.card-description", `共 ${allTabs.length} 个标签长时间未使用，已集中折叠`)),
        ...(featureOn("sleep")
          ? [Button({ label: "全部休眠", icon: "moon", size: "xs", onClick: async () => { const r = await sleepTabs(allTabs.map((t) => t.id)); toast({ title: `已休眠 ${r.slept} 个`, description: r.skipped.length ? `${r.skipped.length} 个不符合休眠条件（使用中 / 已固定 / 受保护）` : "" }); render(); } })]
          : []),
        Button({ label: "全部暂存并关闭", icon: "inbox", size: "xs", variant: "outline", onClick: async () => { const r = await stashTabs(allTabs, { close: true }); toast({ title: `已暂存 ${r.items.length} 个 · 关闭 ${r.closed} 个`, description: r.failed.length ? `${r.failed.length} 个标签未能关闭，已保留。` : "", variant: r.failed.length ? "warning" : "success" }); render(); } })
      ),
      h(
        "div.card-content",
        { style: { padding: "0 14px 12px" } },
        h(
          "div.col.gap-1",
          ...hotCards.map((c) =>
            h(
              "div.row.gap-2",
              { style: { padding: "4px 0", fontSize: "12px" } },
              Favicon({ url: c.tabs[0].url, size: 15 }),
              h("span.flex-1.truncate", c.site),
              h("span.tab-meta", `${c.tabs.length} 个 · 闲置度 ${c.avgIdle}`),
              IdleBadge({ idleScore: c.avgIdle, idleMs: c.maxIdle }),
              Button({ label: "处理", size: "xs", variant: "ghost", onClick: () => { state.expandedSites.add(c.site); patchView({ expandedSites: [...state.expandedSites] }); render(); } })
            )
          )
        )
      )
    );
  }

  await render();
  return wrap;
}

/* ====================================================================== *
 * analytics
 * ====================================================================== */

export async function renderAnalytics(ctx) {
  const summary = analyticsSummary();

  const maxFg = Math.max(1, ...summary.sites.map((s) => s.foregroundMs));
  const maxAct = Math.max(1, ...summary.mostActivated.map((p) => p.activations));

  const siteBars = summary.sites.slice(0, 12).map((s) =>
    h(
      "div.bar-row",
      h("div.row.gap-2.min-h-0", Favicon({ url: `https://${s.site}/`, size: 15 }), h("span.truncate", { style: { fontSize: "12px" } }, s.site)),
      h("div.bar-track", h("div.bar-fill", { style: { width: `${(s.foregroundMs / maxFg) * 100}%` } })),
      h("span.tab-meta", `${formatDuration(s.foregroundMs)} · ${s.activations} 次`)
    )
  );

  const pageRows = summary.topPages.slice(0, 15).map((p) =>
    h(
      "tr",
      h("td", h("div.row.gap-2", Favicon({ url: p.url, size: 15 }), h("span.truncate", { style: { maxWidth: "320px" } }, p.title || p.url))),
      h("td.muted", p.site || siteOf(p.url)),
      h("td.tabular.text-right", formatDuration(p.foregroundMs)),
      h("td.tabular.text-right", String(p.activations)),
      h("td.muted.text-right", formatRelative(p.lastVisitAt))
    )
  );

  const actRows = summary.mostActivated.slice(0, 15).map((p) =>
    h(
      "tr",
      h("td", h("div.row.gap-2", Favicon({ url: p.url, size: 15 }), h("span.truncate", { style: { maxWidth: "320px" } }, p.title || p.url))),
      h("td.tabular.text-right", `${p.activations} 次`),
      h("td.tabular.text-right", h("div.bar-track", { style: { width: "90px", marginLeft: "auto" } }, h("div.bar-fill", { style: { width: `${(p.activations / maxAct) * 100}%` } }))),
      h("td.muted.text-right", formatRelative(p.lastVisitAt))
    )
  );

  return h(
    "div.col.gap-4",
    h(
      "div.stat-grid",
      h("div.stat-card", h("div.stat-label", ico("globe", 12), "跟踪的网址"), h("div.stat-value", String(summary.pages)), h("div.stat-hint", `${summary.neverUsed} 个从未在前台使用`)),
      h("div.stat-card", h("div.stat-label", ico("timer", 12), "累计前台时长"), h("div.stat-value", formatDuration(summary.totalForeground))),
      h("div.stat-card", h("div.stat-label", ico("activity", 12), "累计激活次数"), h("div.stat-value", String(summary.totalActivations)))
    ),
    h("div.col.gap-2", h("div.section-title", ico("bar-chart", 14), "站点前台时长 Top 12"), ...siteBars),
    h(
      "div.col.gap-2",
      h("div.row.gap-2", h("div.section-title", ico("timer", 14), "使用时长 Top 15"), h("span.flex-1"), Button({ label: "重置全部闲置度", icon: "rotate-ccw", size: "xs", variant: "outline", onClick: async () => {
          const urls = Object.values(store.get("stats") || {}).map((s) => s.url);
          await resetIdleFor(urls);
          toast({ title: "已重置所有闲置度" });
          ctx.refresh();
        } }))
      ,
      h(
        "div.table-wrap",
        h("table.table", h("thead", h("tr", h("th", "页面"), h("th", "站点"), h("th", { style: { textAlign: "right" } }, "前台时长"), h("th", { style: { textAlign: "right" } }, "激活"), h("th", { style: { textAlign: "right" } }, "最近访问"))), h("tbody", ...pageRows))
      )
    ),
    h(
      "div.col.gap-2",
      h("div.section-title", ico("activity", 14), "激活次数 Top 15"),
      h(
        "div.table-wrap",
        h("table.table", h("thead", h("tr", h("th", "页面"), h("th", { style: { textAlign: "right" } }, "激活次数"), h("th", { style: { textAlign: "right" } }, "占比"), h("th", { style: { textAlign: "right" } }, "最近访问"))), h("tbody", ...actRows))
      )
    )
  );
}
