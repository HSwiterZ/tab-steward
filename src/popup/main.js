import { h, ico, clear, append, toast, Button, IconButton, ActionTile, Badge, Tabs, Empty, hotkeys } from "../ui/kit.js";
import { MOD_KEY } from "../core/utils.js";
import { bootPage, TabRow, Favicon, toastError, openPalette, standardTabActions, openFavoritePicker, onStorageChanged, featureOn, paletteHint, openSettingsTab } from "../ui/shared.js";
import { renderCollectionsPanel } from "../ui/collections-panel.js";
import { store } from "../core/storage.js";
import { enrichTabs, buildSiteCards } from "../core/stats.js";
import { focusTab, closeTabs, sleepTabs, wakeTabs, windowLabel, windowOrdinals, getAllWindows } from "../core/actions.js";
import { stashTabs, listCollections, openItem, removeItem, STASH_ID } from "../core/collections.js";
import { markDuplicates, closeDuplicates, restoreClosed } from "../core/dupes.js";
import { arrangeBySite } from "../core/organize.js";
import { sleepIdleNow } from "../background/sleep.js";

bootPage(async () => {
  const root = document.getElementById("root");
  const shell = h("div.app-compact");
  append(root, shell);

  let section = new URLSearchParams(location.search).get("section") === "stash" ? "stash" : "tabs";

  const subEl = h("div.topbar-sub");
  const header = h(
    "div.topbar",
    { style: { height: "52px", padding: "0 12px", gap: "10px" } },
    h("img", { src: chrome.runtime.getURL("assets/icon48.png"), style: { width: "26px", height: "26px", borderRadius: "7px" } }),
    h("div.col.flex-1.min-h-0", h("div.topbar-title", { style: { fontSize: "13.5px" } }, "Tab Steward"), subEl),
    ActionTile({ emoji: "magnifying-glass-tilted-left", label: "全局搜索面板", size: "sm", onClick: () => openPalette({ onPick: handlePick }) }),
    ActionTile({ emoji: "house", label: "打开 Dashboard", size: "sm", onClick: () => chrome.runtime.sendMessage({ type: "dashboard:open" }) }),
    ActionTile({ emoji: "gear", label: "设置", size: "sm", onClick: () => openSettingsTab() })
  );

  // same interaction as the dashboard: clicking search opens the palette overlay
  const search = h(
    "button.search-trigger",
    { style: { width: "100%", minWidth: "0" }, onClick: () => openPalette({ onPick: handlePick }) },
    ico("search", 15),
    h("span", paletteHint()),
    h("span.kbd", `${MOD_KEY} K`)
  );
  const searchWrap = h("div", { style: { padding: "8px 10px 4px" } }, search);

  const sectionTabs = Tabs({
    items: [
      { id: "tabs", label: "当前标签", count: 0 },
      { id: "stash", label: "暂存区", count: 0 },
    ],
    value: section,
    onChange: (id) => {
      section = id;
      render();
    },
    cls: "popup-tabs",
  });

  const banner = h("div.banner.hidden");
  const tabsWrap = h("div", { style: { padding: "0 10px" } }, sectionTabs);
  const list = h("div.col.gap-3", { style: { flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "6px 8px 8px" } });

  // the same panel the Dashboard shows on its right, so counts and contents match
  const stashPanel = renderCollectionsPanel({
    navigate: () => chrome.runtime.sendMessage({ type: "dashboard:open", payload: { hash: "data" } }),
    refresh: () => render(),
    toast,
    toastError,
    app: {},
  });

  const footer = h(
    "div.toolbar",
    { style: { padding: "8px 10px", borderTop: "1px solid hsl(var(--border))", borderBottom: "none", gap: "6px" } },
    Button({ label: "暂存当前页", icon: "inbox", size: "xs", onClick: async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return;
        await stashTabs([tab], { close: false, source: "popup" });
        toast({ title: "已加入暂存区" });
        render();
      } }),
    ...(featureOn("sleep")
      ? [Button({ label: "休眠闲置", icon: "moon", size: "xs", variant: "outline", onClick: async () => {
          const r = await sleepIdleNow({ idleMinutes: 60 });
          toast({ title: r.slept ? `已休眠 ${r.slept} 个` : "没有需要休眠的" });
          render();
        } })]
      : []),
    ...(featureOn("organize")
      ? [Button({ label: "整理", icon: "sort-asc", size: "xs", variant: "outline", onClick: async () => {
          const win = await chrome.windows.getCurrent({});
          const r = await arrangeBySite(win.id);
          toast({ title: `已整理 ${r.moved} 个标签` });
          render();
        } })]
      : []),
    h("span.flex-1"),
    h("span.muted.text-xs", { id: "popup-count" })
  );

  append(shell, header, searchWrap, tabsWrap, banner, list, footer);

  /* ------------------------------------------------------------------ */

  async function render() {
    const [win, wins] = await Promise.all([chrome.windows.getCurrent({}), getAllWindows({ populate: false })]);
    const stored = (store.get("windows") || {})[win.id];
    const allTabs = enrichTabs(await chrome.tabs.query({ windowId: win.id }));
    const sites = new Set(allTabs.map((t) => t.site)).size;
    subEl.textContent = `${windowLabel(win, stored, windowOrdinals(wins).get(win.id))} · ${allTabs.length} 个标签 · ${sites} 个站点`;

    const collections = listCollections().filter((c) => featureOn("favorites") || c.id === STASH_ID);
    const itemCount = collections.reduce((s, c) => s + (c.items || []).length, 0);
    const labels = sectionTabs.querySelectorAll(".tabs-trigger");
    if (labels[0]) rebuildTabLabel(labels[0], "当前标签", allTabs.length);
    if (labels[1]) rebuildTabLabel(labels[1], "暂存区", itemCount);

    // duplicate banner for this window
    const { marks, groups } = featureOn("duplicates") ? await markDuplicates({ windowId: win.id }) : { marks: new Map(), groups: [] };
    for (const t of allTabs) {
      const m = marks.get(t.id);
      t.dupeCount = m && !m.isKeeper ? m.count - 1 : 0;
    }
    clear(banner);
    if (groups.length) {
      banner.classList.remove("hidden");
      append(
        banner,
        ico("copy", 14),
        h("span.flex-1", `${groups.length} 组重复标签`),
        Button({ label: "清理", size: "xs", variant: "outline", onClick: async () => {
            const r = await closeDuplicates({ windowId: win.id, keep: "active" });
            toast({ title: `已关闭 ${r.closed} 个`, actions: [{ label: "撤销", onClick: () => restoreClosed(r.closedTabs) }] });
            render();
          } })
      );
    } else banner.classList.add("hidden");

    clear(list);
    if (section === "tabs") {
      renderTabs(allTabs);
    } else {
      stashPanel.refresh();
      append(list, stashPanel.el);
    }

    const count = document.getElementById("popup-count");
    if (count) count.textContent = featureOn("sleep") ? `${allTabs.filter((t) => t.discarded).length} 休眠` : `${allTabs.length} 标签`;
  }

  function rebuildTabLabel(trigger, label, count) {
    clear(trigger);
    append(trigger, label, h("span.badge.badge-muted", { style: { marginLeft: "4px" } }, String(count)));
    trigger.setAttribute("aria-selected", String((label === "当前标签" ? "tabs" : "stash") === section));
  }

  function renderTabs(tabs) {
    if (!tabs.length) {
      append(list, Empty({ icon: "app-window", title: "当前窗口没有标签", desc: "开个新标签开始吧。" }));
      return;
    }
    const cards = buildSiteCards(tabs);
    cards.sort((a, b) => b.avgIdle - a.avgIdle);
    // One tray holding every site card, mirroring the collections panel, so the
    // list reads as a single object instead of a stack of loose boxes.
    const tray = h("div.site-tray");
    for (const card of cards) append(tray, siteGroup(card));
    append(list, tray);
  }

  function siteGroup(card) {
    let open = card.tabs.length <= 4;
    let current = null;

    const build = () => {
      const rows = h("div.site-card-body.col.gap-0-5");
      const anySleepable = card.tabs.some((t) => t.isSleepable);
      if (open) for (const tab of card.tabs) append(rows, TabRow(tab, { actions: tabActions(tab), onOpen: (t) => focusTab(t.id, t.windowId), compact: true }));

      const el = h(
        // Reuse the shared card surface so a site here looks and behaves like a
        // site card on the Dashboard — and like one collection in the panel.
        "div.site-card",
        h(
          "div.site-card-head",
          { style: { cursor: "pointer" }, onClick: (e) => { if (e.target.closest("button")) return; toggle(); } },
          ico(open ? "chevron-down" : "chevron-right", 13, "collapse-chevron"),
          Favicon({ url: card.tabs[0]?.url, size: 24, tinted: true }),
          h("div.col.flex-1.min-h-0", h("div.site-card-title.truncate", card.site), h("div.site-card-sub", `${card.tabs.length} 个标签 · 闲置度 ${card.avgIdle}`)),
          ...(featureOn("duplicates") && card.dupeCount ? [Badge({ label: `重复 ${card.dupeCount}`, variant: "warning", icon: "copy" })] : []),
          ...(featureOn("sleep")
            ? [
                anySleepable
                  ? IconButton({ emoji: "crescent-moon", label: "休眠该站点", size: "xs", onClick: async (e) => { e.stopPropagation(); const r = await sleepTabs(card.tabs.map((t) => t.id)); toast({ title: `已休眠 ${r.slept} 个`, description: r.skipped.length ? `${r.skipped.length} 个不符合休眠条件` : "" }); render(); } })
                  : IconButton({ icon: "moon", iconSize: 16, label: "该站点没有可休眠的标签", size: "xs", disabled: true }),
              ]
            : []),
          IconButton({ icon: "x", iconSize: 16, label: "关闭该站点", size: "xs", onClick: async (e) => { e.stopPropagation(); const r = await closeTabs(card.tabs.map((t) => t.id)); if (r.failed.length) toastError(`${r.failed.length} 个标签关闭失败`, "Chrome 拒绝了关闭请求，其余标签已关闭。"); render(); } })
        ),
        open ? rows : null
      );
      return el;
    };

    const toggle = () => {
      open = !open;
      const next = build();
      if (current?.parentNode) current.replaceWith(next);
      current = next;
    };

    current = build();
    return current;
  }

  function tabActions(tab) {
    return standardTabActions(tab, {
      onDone: render,
      onFavorite: (tabs) => openFavoritePicker(tabs, render),
    });
  }

  async function handlePick(item) {
    try {
      if (item.source === "tab") {
        await chrome.windows.update(item.payload.windowId, { focused: true }).catch(() => {});
        await chrome.tabs.update(item.payload.tabId, { active: true });
        window.close();
      } else if (item.source === "stash") {
        const col = listCollections().find((c) => c.id === item.payload.collectionId);
        const it = col?.items.find((i) => i.id === item.payload.itemId);
        if (it) await chrome.tabs.create({ url: it.url, active: true });
      } else if (item.source === "closed") {
        await chrome.sessions.restore(item.payload.sessionId);
      } else {
        await chrome.tabs.create({ url: item.url, active: true });
      }
      window.close();
    } catch (err) {
      toastError("打开失败", err?.message);
    }
  }

  await render();

  onStorageChanged(() => render());

  hotkeys({
    "mod+k": {
      fn: (e) => {
        e.preventDefault();
        openPalette({ onPick: handlePick });
      },
      allowTyping: true,
    },
  });

  // deep-linkable search, also handy for screenshots: popup.html?q=关键词
  const initialQuery = new URLSearchParams(location.search).get("q");
  if (initialQuery) openPalette({ onPick: handlePick, initial: initialQuery });
});

