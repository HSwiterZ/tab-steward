import { h, ico, clear, append, toast, Button, IconButton, MenuButton, Badge, Select, Input, Switch, Empty, confirmDialog, promptDialog, openDialog, Tabs } from "../ui/kit.js";
import { Favicon, toastError } from "../ui/shared.js";
import { store } from "../core/storage.js";
import {
  listCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  setCollectionCollapsed,
  removeItem,
  updateItem,
  moveItemBetween,
  reorderItems,
  openItem,
  openCollection,
  stashTabs,
  STASH_ID,
} from "../core/collections.js";
import { archiveCollectionToBookmarks, listFolders, saveTabsToBookmarks, createFolder } from "../core/bookmarks.js";
import { historyByRange, RANGES, topSites, unopenedSites, recentlyClosed, restoreSession } from "../core/history.js";
import { listReminders, createReminder, cancelReminder, snoozeReminder, markDone, gotoReminder, describeReminder, removeReminder, ACTIVE_STATUSES } from "../core/reminders.js";
import { listSnapshots, captureSnapshot, renameSnapshot, deleteSnapshot, restoreSnapshot, previewSnapshot } from "../core/snapshots.js";
import { listTrash, restoreEntry, purgeEntry, clearTrash, trashStats } from "../core/trash.js";
import { buildBackup, backupFilename, validateBackup, applyBackup, estimateSize } from "../core/backup.js";
import { formatRelative, formatDateTime, formatDate, downloadJson, readJsonFile, bytes, hostname } from "../core/utils.js";

import { renderCollectionsPanel } from "../ui/collections-panel.js";

export { renderCollectionsPanel };


/* ====================================================================== *
 * library: bookmarks / history / top sites / closed
 * ====================================================================== */

export async function renderLibrary(ctx) {
  const content = h("div.col.gap-3");
  const tabsList = Tabs({
    items: [
      { id: "bookmarks", label: "书签", icon: "bookmark" },
      { id: "history", label: "历史", icon: "history" },
      { id: "top", label: "常去站点", icon: "flame" },
      { id: "closed", label: "最近关闭", icon: "rotate-ccw" },
    ],
    value: "bookmarks",
    onChange: (id) => renderTab(id),
  });

  const wrap = h("div.col.gap-3", tabsList, content);

  async function renderTab(id) {
    clear(content);
    if (id === "bookmarks") append(content, await bookmarksPanel(ctx));
    if (id === "history") append(content, await historyPanel(ctx));
    if (id === "top") append(content, await topSitesPanel(ctx));
    if (id === "closed") append(content, await closedPanel(ctx));
  }

  await renderTab("bookmarks");
  return wrap;
}

async function bookmarksPanel(ctx) {
  const folders = await listFolders();
  let currentFolder = folders[0]?.id || "1";
  let query = "";
  let sortMode = "title";

  const list = h("div.col.gap-1");

  const folderSelect = Select({
    value: currentFolder,
    options: [{ value: "1", label: "书签栏（根）" }, ...folders.map((f) => ({ value: f.id, label: `${"　".repeat(Math.min(4, f.depth - 1))}${f.title}` }))],
    onChange: (v) => {
      currentFolder = v;
      renderList();
    },
  });

  const search = Input({
    placeholder: "搜索书签…",
    cls: "input-sm",
    onInput: (v) => {
      query = v;
      renderList();
    },
  });

  async function renderList() {
    clear(list);
    let nodes;
    if (query) {
      nodes = (await chrome.bookmarks.search(query)).filter((n) => n.url);
    } else {
      nodes = (await chrome.bookmarks.getChildren(currentFolder)).filter((n) => n.url);
    }
    if (sortMode === "title") nodes.sort((a, b) => (a.title || "").localeCompare(b.title || "", "zh-Hans-CN"));
    else if (sortMode === "recent") nodes.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
    else if (sortMode === "url") nodes.sort((a, b) => (a.url || "").localeCompare(b.url || ""));

    if (!nodes.length) {
      append(list, Empty({ icon: "bookmark", title: query ? "没有匹配的书签" : "这个文件夹是空的", desc: query ? "换个关键词试试。" : "可以把当前标签或整个收藏区保存到这里。" }));
      return;
    }
    for (const n of nodes) {
      append(
        list,
        h(
          "div.tab-row",
          { onClick: () => chrome.tabs.create({ url: n.url, active: true }) },
          Favicon({ url: n.url, size: 16 }),
          h("div.col.flex-1.min-h-0", h("div.tab-title", n.title || n.url), h("div.tab-url", n.url.replace(/^https?:\/\//, ""))),
          n.dateAdded ? h("span.tab-meta", formatDate(n.dateAdded)) : null,
          IconButton({ icon: "x", label: "删除书签", size: "xs", onClick: async (e) => {
              e.stopPropagation();
              const ok = await confirmDialog({ title: "删除这条书签？", description: n.title, confirmLabel: "删除", danger: true });
              if (!ok) return;
              await chrome.bookmarks.remove(n.id);
              renderList();
            } })
        )
      );
    }
  }

  await renderList();

  return h(
    "div.col.gap-3",
    h(
      "div.row.gap-2.wrap",
      folderSelect,
      h("div.input-wrap", { style: { maxWidth: "240px" } }, ico("search", 14), search),
      Select({
        value: sortMode,
        cls: "select-sm",
        options: [
          { value: "title", label: "按标题" },
          { value: "recent", label: "按添加时间" },
          { value: "url", label: "按网址" },
        ],
        onChange: (v) => {
          sortMode = v;
          renderList();
        },
      }),
      h("span.flex-1"),
      Button({ label: "新建子目录", icon: "folder-plus", size: "sm", variant: "outline", onClick: async () => {
          const name = await promptDialog({ title: "在当前文件夹下新建子目录", value: "" });
          if (!name) return;
          await createFolder(name, currentFolder);
          toast({ title: `已创建「${name}」` });
          ctx.refresh();
        } }),
      Button({ label: "保存当前标签到这里", icon: "save", size: "sm", onClick: async () => {
          const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          if (!tab) return;
          await chrome.bookmarks.create({ parentId: currentFolder, title: tab.title, url: tab.url });
          toast({ title: "已加入书签", variant: "success" });
          renderList();
        } })
    ),
    list
  );
}

async function historyPanel(ctx) {
  let range = "week";
  const list = h("div.col.gap-3");

  async function render() {
    clear(list);
    const buckets = await historyByRange(range);
    if (!buckets.length) {
      append(list, Empty({ icon: "history", title: "这个时间段没有历史记录", desc: "换个时间范围试试。" }));
      return;
    }
    for (const bucket of buckets) {
      append(
        list,
        h(
          "div.col.gap-1",
          h("div.palette-group-label", ico("calendar", 12), bucket.label, h("span.muted", ` ${bucket.items.length}`)),
          ...bucket.items.slice(0, 40).map((item) =>
            h(
              "div.tab-row",
              { onClick: () => chrome.tabs.create({ url: item.url, active: true }) },
              Favicon({ url: item.url, size: 16 }),
              h("div.col.flex-1.min-h-0", h("div.tab-title", item.title), h("div.tab-url", item.url.replace(/^https?:\/\//, ""))),
              h("span.tab-meta", `${new Date(item.visitTime).getHours()}:${String(new Date(item.visitTime).getMinutes()).padStart(2, "0")} · ${item.visitCount} 次`)
            )
          )
        )
      );
    }
  }

  await render();
  return h(
    "div.col.gap-3",
    h(
      "div.row.gap-2",
      Tabs({
        items: RANGES.map((r) => ({ id: r.id, label: r.label })),
        value: range,
        onChange: (id) => {
          range = id;
          render();
        },
      }),
      h("span.flex-1"),
      Button({ label: "恢复最近关闭", icon: "rotate-ccw", size: "sm", variant: "outline", onClick: async () => {
          const { tabs } = await recentlyClosed({ maxResults: 1 });
          if (!tabs.length) return toast({ title: "没有可恢复的页面", variant: "info" });
          await restoreSession(tabs[0].sessionId);
          toast({ title: "已恢复", variant: "success" });
        } })
    ),
    list
  );
}

async function topSitesPanel(ctx) {
  let onlyUnopened = false;
  const list = h("div.col.gap-1");

  async function render() {
    clear(list);
    const sites = onlyUnopened ? await unopenedSites({ limit: 40 }) : await topSites({ limit: 40 });
    if (!sites.length) {
      append(list, Empty({ icon: "flame", title: "没有数据", desc: onlyUnopened ? "常去的站点现在都开着。" : "浏览一段时间后会出现在这里。" }));
      return;
    }
    for (const s of sites) {
      append(
        list,
        h(
          "div.tab-row",
          { onClick: () => chrome.tabs.create({ url: s.url, active: true }) },
          Favicon({ url: s.url, size: 16 }),
          h("div.col.flex-1.min-h-0", h("div.tab-title", s.site), h("div.tab-url", s.title)),
          s.isOpen ? Badge({ label: "已打开", variant: "success" }) : Badge({ label: "未打开", variant: "outline" }),
          h("span.tab-meta", `${s.visits} 次访问 · ${formatRelative(s.lastVisitTime)}`)
        )
      );
    }
  }

  await render();
  return h(
    "div.col.gap-3",
    h("label.row.gap-2.cursor-pointer", { style: { fontSize: "12px" } },
      Switch({ checked: onlyUnopened, label: "只看尚未打开", onChange: (on) => { onlyUnopened = on; render(); } }),
      "只看当前没有打开标签的站点"),
    list
  );
}

async function closedPanel(ctx) {
  const { tabs, windows } = await recentlyClosed({ maxResults: 30 });
  const list = h("div.col.gap-1");
  if (!tabs.length && !windows.length) {
    return Empty({ icon: "rotate-ccw", title: "最近没有关闭的页面", desc: "关闭标签后会出现在这里，可一键恢复。" });
  }
  for (const t of tabs) {
    append(
      list,
      h(
        "div.tab-row",
        Favicon({ url: t.url, size: 16 }),
        h("div.col.flex-1.min-h-0", h("div.tab-title", t.title), h("div.tab-url", t.url.replace(/^https?:\/\//, ""))),
        h("span.tab-meta", formatRelative(t.lastAccessed)),
        Button({ label: "恢复", size: "xs", variant: "outline", onClick: async () => { await restoreSession(t.sessionId); ctx.refresh(); } })
      )
    );
  }
  for (const w of windows) {
    append(
      list,
      h(
        "div.tab-row",
        ico("app-window", 15),
        h("div.col.flex-1.min-h-0", h("div.tab-title", `窗口（${w.tabCount} 个标签）`), h("div.tab-url", w.tabs.slice(0, 3).map((t) => t.title).join(" · "))),
        h("span.tab-meta", formatRelative(w.lastModified)),
        Button({ label: "恢复窗口", size: "xs", variant: "outline", onClick: async () => { await restoreSession(w.sessionId); ctx.refresh(); } })
      )
    );
  }
  return h("div.col.gap-3", h("div.palette-group-label", ico("rotate-ccw", 12), `标签 ${tabs.length} · 窗口 ${windows.length}`), list);
}

/* ====================================================================== *
 * reminders
 * ====================================================================== */

export async function renderReminders(ctx) {
  const wrap = h("div.col.gap-4");
  const settings = store.get("settings") || {};

  append(wrap, await reminderForm(ctx));

  const pending = listReminders({ includePast: false });
  const past = listReminders({ includePast: true }).filter((r) => !ACTIVE_STATUSES.includes(r.status)).slice(0, 12);

  append(
    wrap,
    h("div.col.gap-2", h("div.section-title", ico("bell", 14), `待触发 · ${pending.length}`), ...(pending.length ? pending.map((r) => reminderRow(r, ctx)) : [Empty({ icon: "bell", title: "没有待触发的提醒", desc: "在上面的表单里给某个页面或站点设一个。" })]))
  );

  if (past.length) {
    append(wrap, h("div.col.gap-2", h("div.section-title", ico("history", 14), "历史"), ...past.map((r) => reminderRow(r, ctx, true))));
  }

  append(
    wrap,
    h(
      "div.card",
      h("div.card-header", h("div.card-title", "提醒方式"), h("div.card-description", "控制到点时通过哪些渠道提醒你。")),
      h(
        "div.card-content.col.gap-2",
        settingToggle("系统通知", "reminders", "systemNotification", settings.reminders?.systemNotification !== false, ctx),
        settingToggle("扩展角标", "reminders", "badge", settings.reminders?.badge !== false, ctx),
        settingToggle("Dashboard 横幅", "reminders", "dashboardBanner", settings.reminders?.dashboardBanner !== false, ctx)
      )
    )
  );

  return wrap;
}

function settingToggle(label, section, key, checked, ctx) {
  return h(
    "div.row.gap-3",
    h("span.flex-1", { style: { fontSize: "12.5px" } }, label),
    Switch({
      checked,
      label,
      onChange: async (on) => {
        const settings = store.get("settings") || {};
        await store.patch("settings", { [section]: { ...(settings[section] || {}), [key]: on } });
        ctx.refresh();
      },
    })
  );
}

/** Searchable popover that lists open tabs; reminders are created from a real tab. */
let closePicker = null;

function openTabPicker(anchor, tabs, onPick) {
  closePicker?.();
  const pop = h("div.picker-pop");
  const filter = Input({ placeholder: "筛选标签标题或网址…", cls: "input-sm" });
  const list = h("div.picker-list");

  const paint = () => {
    clear(list);
    const q = (filter.value || "").toLowerCase();
    const shown = tabs.filter((t) => !q || (t.title || "").toLowerCase().includes(q) || (t.url || "").toLowerCase().includes(q));
    if (!shown.length) {
      append(list, h("div.muted.text-xs", { style: { padding: "8px 10px" } }, "没有匹配的标签"));
      return;
    }
    for (const t of shown.slice(0, 80)) {
      append(
        list,
        h(
          "div.picker-item",
          { onClick: () => { onPick(t); teardown(); } },
          Favicon({ url: t.url, size: 16 }),
          h("div.col.flex-1.min-h-0", h("div.tab-title", t.title || t.url), h("div.tab-url", hostname(t.url))),
          t.active ? Badge({ label: "当前", variant: "success" }) : null,
          t.discarded ? Badge({ label: "已休眠", variant: "muted" }) : null
        )
      );
    }
  };

  const position = () => {
    const r = anchor.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 420 - 8))}px`;
    pop.style.top = `${Math.min(r.bottom + 4, innerHeight - 320)}px`;
  };

  const teardown = () => {
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", position);
    pop.remove();
    if (closePicker === teardown) closePicker = null;
  };
  const onDown = (e) => {
    if (!pop.contains(e.target) && !anchor.contains(e.target)) teardown();
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      teardown();
    }
  };

  filter.addEventListener("input", paint);
  append(pop, h("div", { style: { padding: "6px 6px 2px" } }, filter), list);
  document.body.appendChild(pop);
  position();
  paint();
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", position);
  closePicker = teardown;
  setTimeout(() => filter.focus(), 0);
}

async function reminderForm(ctx) {
  const presets = (store.get("settings") || {}).reminders?.presets || [5, 15, 30, 60, 120, 480];
  const tabs = (await chrome.tabs.query({})).filter((t) => t.url && !/^(chrome|edge|about|devtools):/.test(t.url));
  let scope = "page";
  let offsetMinutes = presets[2] ?? 30;
  let note = "";
  let customAt = null;

  const prefill = ctx.app?.prefillReminder;
  let target = (prefill && tabs.find((t) => t.url === prefill)) || tabs.find((t) => t.active) || tabs[0] || null;
  if (prefill) ctx.app.prefillReminder = null;

  const targetButton = h("button.picker-trigger", { type: "button", title: "选择要提醒的标签" });
  const paintTarget = () => {
    clear(targetButton);
    if (!target) {
      append(targetButton, h("span.muted", "没有可选的标签页"));
      return;
    }
    append(
      targetButton,
      Favicon({ url: target.url, size: 16 }),
      h("span.flex-1.truncate", { style: { textAlign: "left" } }, target.title || target.url),
      h("span.muted.text-xs.truncate", { style: { maxWidth: "160px" } }, hostname(target.url)),
      ico("chevrons-up-down", 14)
    );
  };
  paintTarget();
  targetButton.addEventListener("click", (e) => {
    e.stopPropagation();
    openTabPicker(targetButton, tabs, (t) => {
      target = t;
      paintTarget();
    });
  });

  const noteInput = Input({ value: "", cls: "input-sm", placeholder: "备注（可选），例如：该关掉了", onInput: (v) => (note = v) });

  const presetChips = h(
    "div.chip-row",
    ...presets.map((m) =>
      h(
        "button.chip",
        {
          "aria-pressed": String(m === offsetMinutes && !customAt),
          onClick: (e) => {
            offsetMinutes = m;
            customAt = null;
            for (const c of presetChips.children) c.setAttribute("aria-pressed", "false");
            e.currentTarget.setAttribute("aria-pressed", "true");
          },
        },
        m < 60 ? `${m} 分钟` : `${m / 60} 小时`
      )
    ),
    h("input.input.input-sm", {
      type: "datetime-local",
      style: { width: "190px" },
      onChange: (e) => {
        if (!e.target.value) return;
        customAt = new Date(e.target.value).getTime();
        for (const c of presetChips.children) c.setAttribute("aria-pressed", "false");
      },
    })
  );

  return h(
    "div.card",
    h("div.card-header", h("div.card-title", "新建提醒"), h("div.card-description", "从已打开的标签里选一个目标，可以针对单个页面，也可以针对整个站点。")),
    h(
      "div.card-content.col.gap-3",
      h("div.field", h("label.label", "目标标签"), targetButton),
      h(
        "div.row.gap-3.wrap",
        h("div.field", h("label.label", "范围"), Tabs({ items: [{ id: "page", label: "单个页面" }, { id: "site", label: "整个站点" }], value: scope, onChange: (v) => (scope = v) })),
        h("div.field.flex-1", h("label.label", "时间"), presetChips)
      ),
      h("div.field", h("label.label", "备注"), noteInput),
      h(
        "div.row.gap-2.justify-end",
        Button({
          label: "创建提醒",
          icon: "bell-ring",
          disabled: !target,
          onClick: async () => {
            if (!target) return toastError("请先选择一个标签");
            try {
              const r = await createReminder({ url: target.url, title: target.title || target.url, scope, note, offsetMinutes, fireAt: customAt || undefined });
              toast({ title: "提醒已创建", description: `${formatDateTime(r.fireAt)} · ${r.note || r.title}`, variant: "success" });
              ctx.refresh();
            } catch (err) {
              toastError("创建失败", err?.message);
            }
          },
        })
      )
    )
  );
}

function reminderRow(r, ctx, isPast = false) {
  const info = describeReminder(r);
  return h(
    "div.suggestion",
    { style: isPast ? { opacity: 0.65 } : undefined },
    h("div.suggestion-icon", ico(r.status === "done" ? "circle-check" : r.status === "cancelled" ? "ban" : info.overdue ? "bell-ring" : "bell", 15)),
    h(
      "div.col.flex-1.gap-1",
      h("div.suggestion-title", r.note || r.title),
      h("div.suggestion-detail", `${r.scope === "site" ? `站点 ${r.site}` : r.url.replace(/^https?:\/\//, "")} · ${info.abs}${isPast ? ` · ${r.status === "done" ? "已完成" : "已取消"}` : ` · ${info.label}`}`)
    ),
    !isPast
      ? h(
          "div.row.gap-1",
          Button({ label: "打开", size: "xs", variant: "outline", onClick: async () => gotoReminder(r) }),
          Button({ label: "续时 10 分", size: "xs", variant: "ghost", onClick: async () => { await snoozeReminder(r.id, 10); ctx.refresh(); } }),
          Button({ label: "完成", size: "xs", variant: "ghost", onClick: async () => { await markDone(r.id); ctx.refresh(); } }),
          IconButton({ icon: "x", label: "取消提醒", size: "xs", onClick: async () => { await cancelReminder(r.id); ctx.refresh(); } })
        )
      : IconButton({ icon: "trash", label: "删除记录", size: "xs", onClick: async () => { await removeReminder(r.id); ctx.refresh(); } })
  );
}

/* ====================================================================== *
 * snapshots
 * ====================================================================== */

export async function renderSnapshots(ctx) {
  const wrap = h("div.col.gap-3");

  append(
    wrap,
    h(
      "div.row.gap-2.wrap",
      Button({ label: "保存当前窗口", icon: "camera", onClick: async () => { const s = await captureSnapshot({ scope: "current" }); toast({ title: "快照已保存", description: s.name, variant: "success" }); ctx.refresh(); } }),
      Button({ label: "保存全部窗口", icon: "package", variant: "outline", onClick: async () => { const s = await captureSnapshot({ scope: "all" }); toast({ title: "快照已保存", description: `${s.name} · ${s.windowCount} 窗口 ${s.tabCount} 标签`, variant: "success" }); ctx.refresh(); } }),
      h("span.flex-1"),
      h("span.muted.text-xs", "快照会记录窗口名称与位置、标签顺序、固定状态和 Chrome 分组。")
    )
  );

  const snaps = listSnapshots();
  if (!snaps.length) {
    append(wrap, Empty({ icon: "package", title: "还没有工作区快照", desc: "保存一个快照，之后可以一键回到现在的工作布局。" }));
    return wrap;
  }

  for (const s of snaps) {
    append(
      wrap,
      h(
        "div.card",
        h(
          "div.card-header",
          { style: { flexDirection: "row", alignItems: "center", gap: "10px", padding: "10px 14px" } },
          ico("package", 16),
          h("div.col.flex-1", h("div.card-title", s.name), h("div.card-description", `${formatDateTime(s.createdAt)} · ${s.windowCount} 窗口 · ${s.tabCount} 标签${s.restoreCount ? ` · 恢复过 ${s.restoreCount} 次` : ""}`)),
          Button({ label: "预览", size: "xs", variant: "ghost", onClick: () => showPreview(s, ctx) }),
          Button({ label: "恢复到新窗口", size: "xs", variant: "outline", onClick: async () => {
              const r = await restoreSnapshot(s.id, { mode: "new" });
              toast({ title: `已恢复 ${r.windows} 个窗口 / ${r.tabs} 个标签`, variant: "success" });
            } }),
          MenuButton({
            icon: "ellipsis",
            label: "快照操作",
            size: "xs",
            items: () => [
              { label: "重命名", icon: "pencil", onSelect: async () => { const name = await promptDialog({ title: "重命名快照", value: s.name }); if (!name) return; await renameSnapshot(s.id, name); ctx.refresh(); } },
              { label: "替换当前工作区恢复", icon: "refresh-cw", onSelect: async () => {
                  const ok = await confirmDialog({ title: "替换当前工作区？", description: "会先关闭所有普通窗口，再按快照重建。未保存的表单内容会丢失。", confirmLabel: "替换并恢复", danger: true });
                  if (!ok) return;
                  const r = await restoreSnapshot(s.id, { mode: "new", closeExisting: true });
                  toast({ title: `已恢复 ${r.windows} 个窗口`, variant: "success" });
                } },
              { separator: true },
              { label: "删除快照", icon: "trash", destructive: true, onSelect: async () => {
                  const ok = await confirmDialog({ title: `删除快照「${s.name}」？`, description: "删除后可在回收站恢复。", confirmLabel: "删除", danger: true });
                  if (!ok) return;
                  await deleteSnapshot(s.id);
                  ctx.refresh();
                } },
            ],
          })
        ),
        h(
          "div.card-content",
          h(
            "div.row.gap-2.wrap",
            ...s.windows.map((w) =>
              h("span.badge.badge-outline", { title: w.tabs.slice(0, 8).map((t) => t.title).join("\n") }, `${w.name} · ${w.tabs.length}`)
            )
          )
        )
      )
    );
  }
  return wrap;
}

function showPreview(snap, ctx) {
  const preview = previewSnapshot(snap.id);
  const body = h(
    "div.col.gap-3",
    ...preview.windows.map((w) =>
      h(
        "div.col.gap-1",
        h("div.row.gap-2", ico("app-window", 14), h("span.font-semibold", { style: { fontSize: "12.5px" } }, w.name), Badge({ label: `${w.tabCount} 标签`, variant: "secondary" }), ...w.groups.map((g) => Badge({ label: g, variant: "outline" }))),
        h("div.col.gap-1", { style: { paddingLeft: "22px" } }, ...w.tabs.slice(0, 12).map((t) => h("div.row.gap-2", { style: { fontSize: "12px", padding: "2px 0" } }, Favicon({ url: t.url, size: 14 }), h("span.truncate.flex-1", t.title), t.pinned ? ico("pin", 11) : null, t.groupTitle ? h("span.muted.text-xs", t.groupTitle) : null))),
        w.tabs.length > 12 ? h("div.muted.text-xs", { style: { paddingLeft: "22px" } }, `…还有 ${w.tabs.length - 12} 个`) : null
      )
    )
  );
  let dialogRef = null;
  dialogRef = openDialog({
    title: snap.name,
    description: `${formatDateTime(snap.createdAt)} · ${snap.windowCount} 窗口 · ${snap.tabCount} 标签`,
    size: "lg",
    body,
    footer: Button({ label: "关闭", variant: "ghost", onClick: () => dialogRef.close(null) }),
  });
}

/* ====================================================================== *
 * trash + backup
 * ====================================================================== */

export async function renderData(ctx) {
  const wrap = h("div.col.gap-4");
  const stats = trashStats();

  append(
    wrap,
    h(
      "div.card",
      h("div.card-header", h("div.card-title", "回收站"), h("div.card-description", stats.total ? `${stats.total} 项 · 保留 30 天 · 最早 ${formatRelative(stats.oldest)} 删除` : "删除的收藏项、收藏区和快照会先在这里停留 30 天。")),
      h("div.card-content", await trashList(ctx))
    )
  );

  append(wrap, backupCard(ctx));
  return wrap;
}

async function trashList(ctx) {
  const list = listTrash();
  if (!list.length) return Empty({ icon: "trash", title: "回收站是空的", desc: "删除收藏或快照时，内容会先移到这里。" });

  const box = h("div.col.gap-1");
  for (const entry of list) {
    append(
      box,
      h(
        "div.tab-row",
        ico(entry.kind === "collection" ? "folder" : entry.kind === "snapshot" ? "package" : entry.kind === "site" ? "globe" : "file-text", 15),
        h("div.col.flex-1.min-h-0", h("div.tab-title", entry.label || "未命名"), h("div.tab-url", `${{ collection: "收藏区", item: "收藏项", snapshot: "工作区快照", site: "站点设置" }[entry.kind]} · 删除于 ${formatDateTime(entry.deletedAt)}`)),
        Button({ label: "恢复", size: "xs", variant: "outline", onClick: async () => { const r = await restoreEntry(entry.id); if (!r.ok) return toastError("恢复失败", r.error); toast({ title: "已恢复", variant: "success" }); ctx.refresh(); } }),
        Button({ label: "永久删除", size: "xs", variant: "ghost", onClick: async () => {
            const ok = await confirmDialog({ title: "永久删除？", description: "这一步无法撤销。", confirmLabel: "永久删除", danger: true });
            if (!ok) return;
            await purgeEntry(entry.id);
            ctx.refresh();
          } })
      )
    );
  }
  append(
    box,
    h("div.row.justify-end", { style: { paddingTop: "8px" } }, Button({ label: "清空回收站", icon: "trash", size: "xs", variant: "destructive", onClick: async () => {
        const ok = await confirmDialog({ title: "清空回收站？", description: `${list.length} 项将被永久删除，无法恢复。`, confirmLabel: "清空", danger: true });
        if (!ok) return;
        const r = await clearTrash();
        toast({ title: `已清空 ${r.cleared} 项` });
        ctx.refresh();
      } }))
  );
  return box;
}

function backupCard(ctx) {
  const fileInput = h("input", { type: "file", accept: "application/json,.json", style: { display: "none" } });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const data = await readJsonFile(file);
      await showImportPreview(data, ctx);
    } catch (err) {
      toastError("导入失败", err?.message);
    } finally {
      fileInput.value = "";
    }
  });

  return h(
    "div.card",
    h("div.card-header", h("div.card-title", "备份与迁移"), h("div.card-description", "导出为 JSON 文件；导入前会先预览并校验，可选择合并或覆盖。")),
    h(
      "div.card-content.row.gap-2.wrap",
      Button({ label: "导出 JSON 备份", icon: "download", onClick: () => {
          const data = buildBackup({});
          downloadJson(backupFilename(), data);
          toast({ title: "备份已导出", description: `${bytes(estimateSize(data))}`, variant: "success" });
        } }),
      Button({ label: "从文件导入…", icon: "upload", variant: "outline", onClick: () => fileInput.click() }),
      fileInput
    )
  );
}

async function showImportPreview(data, ctx) {
  const report = validateBackup(data);
  let dialogRef = null;
  if (!report.ok) {
    dialogRef = openDialog({
      title: "这个文件无法导入",
      size: "sm",
      body: h("div.col.gap-2", ...report.errors.map((e) => h("div.alert.alert-destructive", ico("circle-x", 15), h("div", e)))),
      footer: Button({ label: "知道了", variant: "ghost", onClick: () => dialogRef.close(null) }),
    });
    return;
  }

  const rows = report.summary.sections.map((s) =>
    h("tr", h("td", s.label), h("td.tabular.text-right", String(s.current)), h("td.tabular.text-right", String(s.incoming)))
  );

  let mode = "merge";
  const body = h(
    "div.col.gap-3",
    report.warnings.length ? h("div.col.gap-1", ...report.warnings.map((w) => h("div.alert.alert-warning", ico("alert-triangle", 15), h("div", w)))) : null,
    h(
      "div.table-wrap",
      h("table.table", h("thead", h("tr", h("th", "数据段"), h("th", { style: { textAlign: "right" } }, "当前"), h("th", { style: { textAlign: "right" } }, "导入文件"))), h("tbody", ...rows))
    ),
    h("div.col.gap-2",
      h("label.row.gap-2.cursor-pointer", { style: { fontSize: "12.5px" } }, h("input", { type: "radio", name: "import-mode", checked: true, onChange: () => (mode = "merge") }), "合并：保留现有数据，只补充新内容"),
      h("label.row.gap-2.cursor-pointer", { style: { fontSize: "12.5px" } }, h("input", { type: "radio", name: "import-mode", onChange: () => (mode = "overwrite") }), "覆盖：用文件内容替换对应数据段"))
  );

  dialogRef = openDialog({
    title: "导入预览",
    description: report.summary.exportedAt ? `备份时间：${formatDateTime(report.summary.exportedAt)}` : "",
    size: "md",
    body,
    footer: h(
      "div.row.gap-2",
      Button({ label: "取消", variant: "ghost", onClick: () => dialogRef.close(null) }),
      Button({ label: "开始导入", variant: "primary", onClick: () => dialogRef.close(mode) })
    ),
    onClose: async (chosen) => {
      if (!chosen) return;
      const result = await applyBackup(data, { mode: chosen });
      if (result.errors.length) toastError("部分数据导入失败", result.errors.join("；"));
      else toast({ title: `导入完成（${chosen === "merge" ? "合并" : "覆盖"}）`, description: `应用了 ${result.applied.length} 个数据段`, variant: "success" });
      ctx.refresh();
    },
  });
}
