/**
 * The collections panel, shared by the Dashboard's right column and the popup's
 * 暂存区 section, so both surfaces show exactly the same thing.
 */
import { h, ico, clear, append, toast, Button, IconButton, MenuButton, Badge, Empty, confirmDialog, promptDialog } from "./kit.js";
import { Favicon, toastError, featureOn } from "./shared.js";
import {
  listCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  removeItem,
  updateItem,
  moveItemBetween,
  reorderItems,
  openItem,
  openCollection,
  STASH_ID,
} from "../core/collections.js";
import { archiveCollectionToBookmarks } from "../core/bookmarks.js";
import { formatRelative, hostname } from "../core/utils.js";

/* ====================================================================== *
 * collections / stash
 * ====================================================================== */

/**
 * Right-hand collections panel: always visible, compact, drag between
 * collections, per-collection menu, expandable item lists.
 */
export function renderCollectionsPanel(ctx) {
  const expanded = new Set();
  const drag = { id: null, from: null };
  const list = h("div.col.gap-1-5");

  const refresh = () => {
    syncChrome();
    // With the 收藏区 module off, the panel is just the built-in 暂存区.
    const collections = listCollections().filter((c) => featureOn("favorites") || c.id === STASH_ID);
    const total = collections.reduce((s, c) => s + (c.items || []).length, 0);
    const countBadge = panel.querySelector(".panel-count");
    if (countBadge) countBadge.textContent = String(total);
    clear(list);
    for (const col of collections) list.appendChild(panelCollection(col));
    if (!collections.length) append(list, Empty({ icon: "layers", title: "还没有收藏区", desc: "点下面的「新建收藏区」创建第一个。" }));
  };

  function panelCollection(col) {
    const items = col.items || [];
    const isOpen = expanded.has(col.id);
    const body = h("div.collection-body", { dataset: { collection: col.id } });
    for (const item of items) append(body, renderStashItem(col, item, { refresh }));
    if (isOpen && !items.length) {
      append(body, h("div.muted.text-xs", { style: { padding: "8px 10px" } }, "空的：把标签拖进来，或用标签行上的暂存 / 收藏按钮。"));
    }

    const el = h(
      "div.side-col-item",
      { dataset: { id: col.id } },
      h(
        "div.side-col-head",
        {
          onClick: (e) => {
            if (e.target.closest("button")) return;
            if (expanded.has(col.id)) expanded.delete(col.id);
            else expanded.add(col.id);
            refresh();
          },
        },
        ico(isOpen ? "chevron-down" : "chevron-right", 13, "collapse-chevron"),
        ico(col.id === STASH_ID ? "inbox" : "folder", 14),
        h("span.flex-1.truncate", { style: { fontSize: "12.5px", fontWeight: 600 } }, col.name),
        Badge({ label: String(items.length), variant: items.length ? "primary" : "muted" }),
        MenuButton({ icon: "ellipsis", label: `${col.name} 操作`, size: "xs", items: () => collectionMenu(col, refresh) })
      ),
      isOpen ? body : null
    );
    if (isOpen) installCollectionDnd(body, col, { refresh }, drag);
    return el;
  }

  const iconFolder = ico("folder", 15);
  const iconInbox = ico("inbox", 15);
  const titleEl = h("span.font-semibold", { style: { fontSize: "13px" } }, "我的收藏区");
  const hintEl = h("div.side-panel-hint", "");
  const trashBtn = Button({ label: "回收站", icon: "trash", size: "xs", variant: "ghost", onClick: () => ctx.navigate("data") });
  const createWrap = h(
    "div",
    { style: { padding: "10px 4px 4px" } },
    Button({
      label: "新建收藏区",
      icon: "plus",
      size: "sm",
      variant: "outline",
      cls: "w-full",
      onClick: async () => {
        const name = await promptDialog({ title: "新建收藏区", value: "", placeholder: "例如：论文 / 购物清单" });
        if (!name) return;
        await createCollection(name);
        refresh();
      },
    })
  );

  const panel = h(
    "aside.side-panel",
    h("div.side-panel-head", iconFolder, iconInbox, titleEl, Badge({ label: "0", variant: "primary", cls: "panel-count" }), h("span.flex-1"), trashBtn),
    hintEl,
    list,
    createWrap
  );

  /** The panel's own chrome follows the module switches, which can flip while it is open. */
  const syncChrome = () => {
    const fav = featureOn("favorites");
    iconFolder.classList.toggle("hidden", !fav);
    iconInbox.classList.toggle("hidden", fav);
    titleEl.textContent = fav ? "我的收藏区" : "暂存区";
    hintEl.textContent = fav ? "拖拽条目到任一收藏区移动；双击条目 = 打开并移出。" : "双击条目 = 打开并移出。";
    trashBtn.classList.toggle("hidden", !featureOn("trash"));
    createWrap.classList.toggle("hidden", !fav);
  };

  refresh();

  return {
    el: panel,
    refresh,
    focus(collectionId, itemId) {
      expanded.add(collectionId);
      refresh();
      requestAnimationFrame(() => {
        const colEl = panel.querySelector(`.side-col-item[data-id="${collectionId}"]`);
        colEl?.scrollIntoView({ block: "center" });
        const rowEl = itemId ? colEl?.querySelector(`.stash-item[data-id="${itemId}"]`) : null;
        rowEl?.scrollIntoView({ block: "center" });
        const target = rowEl || colEl;
        if (target) {
          target.style.transition = "background 220ms ease";
          target.style.background = "hsl(var(--ring) / 0.16)";
          setTimeout(() => (target.style.background = ""), 900);
        }
      });
    },
  };
}

function collectionMenu(col, refresh) {
  const count = (col.items || []).length;
  return [
    {
      label: "重命名",
      icon: "pencil",
      onSelect: async () => {
        const name = await promptDialog({ title: "重命名收藏区", value: col.name });
        if (!name) return;
        await renameCollection(col.id, name);
        refresh();
      },
    },
    { separator: true },
    {
      label: "在新窗口打开全部",
      icon: "app-window",
      disabled: !count,
      onSelect: async () => {
        const r = await openCollection(col.id, { newWindow: true });
        toast({ title: `已在新窗口打开 ${r.opened} 个标签` });
      },
    },
    {
      label: "归档为 Chrome 书签",
      icon: "bookmark",
      disabled: !count,
      onSelect: async () => {
        const r = await archiveCollectionToBookmarks(col.id);
        toast({ title: `已归档 ${r.created} 条书签`, description: `位置：标签管理器 / ${col.name}` });
      },
    },
    { separator: true },
    ...(col.id === STASH_ID
      ? [{ label: "暂存区不可删除", disabled: true }]
      : [
          {
            label: "删除收藏区",
            icon: "trash",
            destructive: true,
            onSelect: async () => {
              const ok = await confirmDialog({
                title: `删除「${col.name}」？`,
                description: `${count} 个条目会进入回收站，30 天内可恢复。`,
                confirmLabel: "删除",
                danger: true,
              });
              if (!ok) return;
              await deleteCollection(col.id);
              toast({ title: "已删除，可在回收站恢复", variant: "success" });
              refresh();
            },
          },
        ]),
  ];
}


function renderStashItem(col, item, ctx) {
  const row = h(
    "div.stash-item",
    { dataset: { id: item.id, collection: col.id, sortable: "true" }, draggable: true },
    h("span.grip", ico("grip-vertical", 13)),
    Favicon({ url: item.url, size: 16 }),
    h(
      "div.col.flex-1.min-h-0",
      { onDblclick: async () => { await openItem(item, { remove: true, collectionId: col.id }); ctx.refresh(); } },
      h("div.tab-title", item.title),
      h("div.tab-url", `${item.url.replace(/^https?:\/\//, "")} · ${formatRelative(item.addedAt)}${item.note ? ` · ${item.note}` : ""}`)
    ),
    item.pinned ? Badge({ label: "固定", variant: "secondary", icon: "pin" }) : null,
    IconButton({ icon: "external-link", label: "打开（保留收藏）", size: "xs", onClick: (e) => { e.stopPropagation(); openItem(item, { remove: false }); } }),
    IconButton({ icon: "arrow-right", label: "打开并移出", size: "xs", onClick: async (e) => { e.stopPropagation(); await openItem(item, { remove: true, collectionId: col.id }); ctx.refresh(); } }),
    IconButton({ icon: "pencil", label: "备注", size: "xs", onClick: async (e) => {
        e.stopPropagation();
        const note = await promptDialog({ title: "备注", value: item.note || "", multiline: true });
        if (note == null) return;
        await updateItem(col.id, item.id, { note });
        ctx.refresh();
      } }),
    IconButton({ icon: "x", label: "移出收藏区", size: "xs", onClick: async (e) => { e.stopPropagation(); await removeItem(col.id, item.id); toast({ title: "已移出，可在回收站恢复" }); ctx.refresh(); } })
  );
  return row;
}

/** Cross-collection drag & drop, plus reordering inside one collection. */
// Drag state lives on the panel, not per collection: a drop landing on another
// collection has to know which row started the drag and where it came from.
function installCollectionDnd(container, col, ctx, drag) {
  container.addEventListener("dragstart", (e) => {
    const row = e.target.closest(".stash-item");
    if (!row) return;
    drag.id = row.dataset.id;
    drag.from = row.dataset.collection;
    row.dataset.dragging = "true";
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", drag.id);
    } catch {
      /* ignore */
    }
  });

  container.addEventListener("dragover", (e) => {
    if (!drag.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  });

  container.addEventListener("drop", async (e) => {
    if (!drag.id) return;
    e.preventDefault();
    const over = e.target.closest(".stash-item");
    const toCol = container.dataset.collection;
    const siblings = [...container.querySelectorAll(".stash-item")].filter((n) => n.dataset.id !== drag.id);
    let index = -1;
    if (over && over.dataset.id !== drag.id) {
      const pos = siblings.indexOf(over);
      const before = e.clientY < over.getBoundingClientRect().top + over.getBoundingClientRect().height / 2;
      index = pos + (before ? 0 : 1);
    }

    try {
      if (drag.from === toCol) {
        await reorderItems(toCol, drag.id, index);
      } else {
        await moveItemBetween(drag.id, drag.from, toCol, index);
      }
      ctx.refresh();
    } catch (err) {
      toastError("移动失败", err?.message);
    } finally {
      drag.id = null;
      drag.from = null;
    }
  });

  container.addEventListener("dragend", () => {
    drag.id = null;
    drag.from = null;
    for (const n of container.querySelectorAll("[data-dragging]")) n.dataset.dragging = "false";
  });

  // dropping onto an empty collection body
  const collectionEl = container.closest(".side-col-item");
  collectionEl?.addEventListener("dragover", (e) => {
    if (drag.id && drag.id !== e.target.closest(".stash-item")?.dataset.id) e.preventDefault();
  });
  collectionEl?.addEventListener("drop", async (e) => {
    if (!drag.id || e.target.closest(".stash-item")) return;
    e.preventDefault();
    const toCol = container.dataset.collection;
    try {
      if (drag.from !== toCol) await moveItemBetween(drag.id, drag.from, toCol, -1);
      ctx.refresh();
    } finally {
      drag.id = null;
      drag.from = null;
    }
  });
}
