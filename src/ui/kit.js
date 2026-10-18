import { iconSvg } from "./icons.js";
import { uid, clamp, highlight } from "../core/utils.js";

/* ====================================================================== *
 * Element factory
 * ====================================================================== */

const SVG_NS = "http://www.w3.org/2000/svg";

function splitTag(tag) {
  let id = null;
  const classes = [];
  const parts = String(tag).split(/(?=[.#])/);
  const name = parts.shift() || "div";
  for (const p of parts) {
    if (p.startsWith("#")) id = p.slice(1);
    else if (p.startsWith(".")) classes.push(p.slice(1));
  }
  return { name, id, classes };
}

function applyClass(el, value) {
  if (!value) return;
  if (typeof value === "string") {
    el.classList.add(...value.split(/\s+/).filter(Boolean));
  } else if (Array.isArray(value)) {
    for (const v of value) applyClass(el, v);
  } else if (typeof value === "object") {
    for (const [k, on] of Object.entries(value)) if (on) el.classList.add(...k.split(/\s+/).filter(Boolean));
  }
}

function applyChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === true) continue;
    if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

/**
 * h("div.card", { onClick }, ...children)
 *
 * Props: class, style (object|string), text, marks ({text, query} -> escaped
 * <mark> highlighting), dataset, attrs, on<Event>, ref. Anything else becomes
 * a property when the element supports it, otherwise an attribute.
 *
 * There is deliberately no raw-HTML prop: every string that reaches the DOM
 * goes through textContent, so tab titles and URLs can never inject markup.
 */
export function h(tag, props, ...children) {
  if (typeof tag === "function") return tag(props || {}, children);

  const { name, id, classes } = splitTag(tag);
  const el = document.createElement(name);
  if (id) el.setAttribute("id", id);
  if (classes.length) el.setAttribute("class", classes.join(" "));

  // h("div.card", someNodeOrString) — a non-plain-object second argument is a child.
  let kids = children;
  if (props != null && (typeof props !== "object" || props instanceof Node || Array.isArray(props))) {
    kids = [props, ...children];
    props = null;
  }

  const p = props || {};
  for (const key of Object.keys(p)) {
    const value = p[key];
    if (value == null || value === false) continue;
    switch (key) {
      case "class":
      case "className":
        applyClass(el, value);
        break;
      case "style":
        if (typeof value === "string") el.style.cssText = value;
        else
          for (const [sk, sv] of Object.entries(value)) {
            if (sv == null) continue;
            // setProperty only understands kebab-case, so accept camelCase too.
            el.style.setProperty(sk.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`), String(sv));
          }
        break;
      case "text":
        el.textContent = String(value);
        break;
      case "marks":
        // highlight() escapes both the haystack and the needle before wrapping matches.
        el.innerHTML = highlight(value.text, value.query);
        break;
      case "dataset":
        for (const [dk, dv] of Object.entries(value)) {
          if (dv == null) continue;
          el.setAttribute(`data-${dk.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`, String(dv));
        }
        break;
      case "attrs":
        for (const [ak, av] of Object.entries(value)) if (av != null) el.setAttribute(ak, av);
        break;
      case "ref":
        value(el);
        break;
      case "value":
      case "checked":
      case "selected":
      case "disabled":
      case "multiple":
      case "indeterminate":
        el[key] = value;
        break;
      default:
        if (key.length > 2 && key.startsWith("on") && typeof value === "function") {
          el.addEventListener(key.slice(2).toLowerCase(), value);
        } else {
          el.setAttribute(key, value === true ? "" : String(value));
        }
    }
  }

  applyChildren(el, kids);
  return el;
}

export const frag = (...children) => {
  const f = document.createDocumentFragment();
  applyChildren(f, children);
  return f;
};

export const clear = (el) => {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
};

export const mount = (el, ...children) => append(el, ...children);

export function append(el, ...children) {
  applyChildren(el, children);
  return el;
}

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Icon as an element. `html` is only ever fed static markup from icons.js. */
export function ico(name, size = 16, cls = "") {
  const span = document.createElement("span");
  span.className = `ico ${cls}`.trim();
  span.innerHTML = iconSvg(name, size);
  const svg = span.firstElementChild;
  svg.classList.add(...cls.split(/\s+/).filter(Boolean));
  return svg;
}

/* ====================================================================== *
 * Primitives
 * ====================================================================== */

export function Button({ label, icon, variant = "outline", size = "sm", onClick, disabled, title, trailing, cls, type = "button" }) {
  return h(
    `button.btn.btn-${variant}`,
    { type, onClick, disabled, title: title || label, class: [size !== "md" && `btn-${size}`, cls] },
    icon ? ico(icon, size === "xs" ? 12 : size === "lg" ? 17 : 15) : null,
    label ? h("span", label) : null,
    trailing || null
  );
}

export function IconButton({ icon, onClick, label, variant = "ghost", size = "sm", disabled, cls, pressed }) {
  return h(
    `button.btn.btn-icon.btn-${variant}`,
    {
      type: "button",
      onClick,
      disabled,
      title: label,
      "aria-label": label,
      "data-tip": label,
      class: [`btn-${size}`, pressed != null && `is-pressed-${pressed}`, cls],
      "aria-pressed": pressed == null ? null : String(pressed),
    },
    ico(icon, size === "xs" ? 12 : size === "lg" ? 17 : 15)
  );
}

export function Badge({ label, variant = "secondary", icon, cls, title }) {
  return h(
    `span.badge.badge-${variant}`,
    { class: cls, title },
    icon ? ico(icon, 11) : null,
    label != null ? String(label) : null
  );
}

export function Switch({ checked, onChange, disabled, label, id }) {
  const el = h("button.switch", {
    type: "button",
    role: "switch",
    id,
    disabled,
    "aria-checked": String(!!checked),
    "aria-label": label || "",
    onClick: () => {
      if (disabled) return;
      const next = el.getAttribute("aria-checked") !== "true";
      el.setAttribute("aria-checked", String(next));
      onChange?.(next);
    },
  });
  return el;
}

export function Checkbox({ checked, indeterminate, onChange, label, disabled }) {
  const el = h(
    "button.checkbox",
    {
      type: "button",
      role: "checkbox",
      disabled,
      "aria-label": label || "",
      "aria-checked": indeterminate ? "mixed" : String(!!checked),
      "data-indeterminate": indeterminate ? "true" : null,
      onClick: (e) => {
        e.stopPropagation();
        if (disabled) return;
        const next = !(el.getAttribute("aria-checked") === "true");
        el.setAttribute("aria-checked", String(next));
        el.removeAttribute("data-indeterminate");
        onChange?.(next);
      },
    },
    ico("check", 11)
  );
  return el;
}

export function Input({ value = "", placeholder, onInput, onChange, type = "text", cls, id, disabled, autofocus, onKeyDown, spellcheck = false }) {
  return h("input.input", {
    type,
    value,
    placeholder,
    id,
    disabled,
    autofocus,
    spellcheck,
    class: cls,
    onInput: (e) => onInput?.(e.target.value, e),
    onChange: (e) => onChange?.(e.target.value, e),
    onKeyDown,
  });
}

export function Select({ value, options, onChange, cls, disabled, id }) {
  return h(
    "select.select",
    {
      id,
      disabled,
      class: cls,
      onChange: (e) => onChange?.(e.target.value, e),
    },
    options.map((opt) =>
      typeof opt === "string"
        ? h("option", { value: opt, selected: opt === value }, opt)
        : h("option", { value: opt.value, selected: String(opt.value) === String(value), disabled: opt.disabled }, opt.label)
    )
  );
}

export function Field({ label, hint, children, cls }) {
  return h(
    "div.field",
    { class: cls },
    label ? h("label.label", label) : null,
    children,
    hint ? h("div.field-hint", hint) : null
  );
}

export function Empty({ icon = "inbox", title, desc, action }) {
  return h(
    "div.empty",
    h("div.empty-icon", ico(icon, 18)),
    title ? h("div.empty-title", title) : null,
    desc ? h("div.empty-desc", desc) : null,
    action || null
  );
}

export function Spinner(size = 15) {
  const s = ico("loader", size);
  s.style.animation = "spin 900ms linear infinite";
  return s;
}

export function ensureSpinKeyframes() {
  if (document.getElementById("kit-spin")) return;
  const style = document.createElement("style");
  style.id = "kit-spin";
  style.textContent = "@keyframes spin{to{transform:rotate(360deg)}}";
  document.head.appendChild(style);
}

/* ====================================================================== *
 * Keyed reconciler — keeps DOM nodes (and their hover/drag state) stable
 * across re-renders of long tab lists.
 * ====================================================================== */

export function reconcile(parent, items, keyOf, create, update) {
  const existing = new Map();
  for (const child of [...parent.children]) {
    const k = child.dataset?.key;
    if (k != null) existing.set(k, child);
  }
  const seen = new Set();
  const nextNodes = [];
  items.forEach((item, index) => {
    const key = String(keyOf(item, index));
    seen.add(key);
    let node = existing.get(key);
    if (node) {
      update?.(node, item, index);
    } else {
      node = create(item, index);
      node.dataset.key = key;
    }
    nextNodes.push(node);
  });
  for (const [key, node] of existing) if (!seen.has(key)) node.remove();

  let cursor = parent.firstChild;
  for (const node of nextNodes) {
    if (cursor === node) {
      cursor = cursor.nextSibling;
    } else {
      parent.insertBefore(node, cursor);
    }
  }
  return parent;
}

/* ====================================================================== *
 * Menu (dropdown)
 * ====================================================================== */

let activeMenu = null;

export function closeMenu() {
  activeMenu?.close();
  activeMenu = null;
  // Hard invariant: at most one menu in the document, no matter how it was opened.
  for (const m of document.querySelectorAll("body > .menu")) m.remove();
}

/**
 * A menu item that throws must not fail silently — the user clicked something
 * and deserves to see why nothing happened.
 */
function reportActionFailure(err) {
  console.error("[menu] action failed", err);
  toast({ title: "这个操作出错了", description: String(err?.message || err), variant: "destructive", duration: 7000 });
}

/**
 * items: [{ label, icon, onSelect, disabled, checked, destructive, shortcut,
 *           separator, heading, submenu }]
 */
export function openMenu(anchor, items, opts = {}) {
  if (!opts.nested) closeMenu();
  const layer = document.body;

  const menu = h("div.menu", { role: "menu" });
  const state = { open: true, submenu: null, index: -1 };

  const renderItem = (item) => {
    if (item.separator) return h("div.menu-sep");
    if (item.heading) return h("div.menu-label", item.heading);

    const el = h(
      "button.menu-item",
      {
        type: "button",
        role: "menuitem",
        disabled: item.disabled,
        class: [item.destructive && "menu-item-destructive"],
        onClick: (e) => {
          e.stopPropagation();
          if (item.disabled) return;
          if (item.submenu) return;
          state.open = false;
          teardown();
          try {
            const r = item.onSelect?.(item);
            if (r && typeof r.catch === "function") r.catch(reportActionFailure);
          } catch (err) {
            reportActionFailure(err);
          }
        },
        onMouseEnter: () => {
          state.index = [...menu.children].indexOf(el);
          paintActive();
          if (state.submenu) {
            state.submenu.remove();
            state.submenu = null;
          }
          if (item.submenu && !item.disabled) {
            state.submenu = openMenu(el, item.submenu, { nested: true, preferredSide: "right" });
          }
        },
      },
      item.checked != null ? h("span.menu-check", item.checked ? ico("check", 13) : null) : item.icon ? ico(item.icon, 14) : null,
      h("span.flex-1.truncate", item.label || ""),
      item.submenu ? ico("chevron-right", 13, "menu-trail") : item.shortcut ? h("span.menu-trail", item.shortcut) : null
    );
    return el;
  };

  const paintActive = () => {
    [...menu.children].forEach((c, i) => c.setAttribute("data-active", i === state.index ? "true" : "false"));
  };

  for (const item of items) menu.appendChild(renderItem(item));

  const position = () => {
    const rect = anchor.getBoundingClientRect?.() || { left: 0, top: 0, bottom: 0, right: 0, width: 0, height: 0 };
    menu.style.visibility = "hidden";
    // Leave the flow before measuring: while the menu is a static block it
    // stretches to the body width, so offsetWidth would read as the viewport and
    // the align:"end" maths would clamp every menu to the left edge.
    menu.style.position = "fixed";
    if (!menu.isConnected) layer.appendChild(menu);
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const side = opts.preferredSide || "bottom";
    let left = side === "right" ? rect.right + 4 : rect.left;
    let top = side === "right" ? rect.top : rect.bottom + 4;
    if (opts.align === "end") left = rect.right - mw;
    // An anchor that was re-rendered away reports an empty rect; keep the menu on screen anyway.
    const detached = rect.width === 0 && rect.height === 0 && rect.left === 0 && rect.top === 0;
    if (detached) {
      left = 8;
      top = 8;
    }
    left = clamp(left, 8, Math.max(8, innerWidth - mw - 8));
    if (top + mh > innerHeight - 8) {
      const above = side === "right" ? rect.top : rect.top - mh - 4;
      top = above > 8 ? above : Math.max(8, innerHeight - mh - 8);
    }
    top = clamp(top, 8, Math.max(8, innerHeight - mh - 8));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    menu.style.visibility = "";
  };

  const onDocDown = (e) => {
    if (menu.contains(e.target)) return;
    if (state.submenu?.contains?.(e.target)) return;
    teardown();
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      teardown();
      return;
    }
    const enabled = [...menu.children].filter((c) => c.classList.contains("menu-item") && !c.disabled);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      let i = enabled.findIndex((c) => c.dataset.active === "true");
      i = (i + dir + enabled.length) % enabled.length;
      [...menu.children].forEach((c) => c.setAttribute("data-active", "false"));
      enabled[i]?.setAttribute("data-active", "true");
      enabled[i]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      const cur = enabled.find((c) => c.dataset.active === "true");
      if (cur) {
        e.preventDefault();
        cur.click();
      }
    }
  };

  const teardown = () => {
    if (!state.open) return;
    state.open = false;
    state.submenu?.close?.();
    document.removeEventListener("pointerdown", onDocDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", position);
    window.removeEventListener("scroll", position, true);
    menu.remove();
    if (activeMenu === api) activeMenu = null;
    opts.onClose?.();
  };

  const api = { close: teardown, el: menu, anchor, contains: (n) => menu.contains(n) };
  position();
  document.addEventListener("pointerdown", onDocDown, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", position);
  window.addEventListener("scroll", position, true);
  if (!opts.nested) activeMenu = api;
  return api;
}

export function MenuButton({ icon = "ellipsis", label, items, variant = "ghost", size = "sm", cls, align = "end" }) {
  const btn = IconButton({ icon, label: label || "更多操作", variant, size, cls });
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (activeMenu && activeMenu.anchor === btn) {
      closeMenu();
      return;
    }
    const resolved = typeof items === "function" ? items() : items;
    openMenu(btn, resolved, { align });
  });
  return btn;
}

/* ====================================================================== *
 * Dialog
 * ====================================================================== */

const dialogStack = [];

export function openDialog({ title, description, body, footer, size = "", dismissable = true, onOpen, onClose, className }) {
  const previousFocus = document.activeElement;
  const overlay = h("div.overlay");
  const el = h(
    `div.dialog${size ? `.dialog-${size}` : ""}`,
    { role: "dialog", "aria-modal": "true", class: className },
    title || description
      ? h(
          "div.dialog-header",
          title ? h("div.dialog-title", title) : null,
          description ? h("div.dialog-description", description) : null
        )
      : null,
    body ? h("div.dialog-body", body) : null,
    footer ? h("div.dialog-footer", footer) : null
  );

  const api = {
    el,
    overlay,
    close(result) {
      const idx = dialogStack.indexOf(api);
      if (idx === -1) return;
      dialogStack.splice(idx, 1);
      overlay.remove();
      el.remove();
      document.removeEventListener("keydown", onKey, true);
      if (!dialogStack.length) document.body.style.overflow = "";
      if (previousFocus?.isConnected) previousFocus.focus();
      onClose?.(result);
    },
    setTitle(t) {
      const node = qs(".dialog-title", el);
      if (node) node.textContent = t;
    },
    setBody(node) {
      const holder = qs(".dialog-body", el);
      if (holder) {
        clear(holder);
        append(holder, node);
      }
    },
    setFooter(node) {
      let holder = qs(".dialog-footer", el);
      if (!holder) {
        holder = h("div.dialog-footer");
        el.appendChild(holder);
      }
      clear(holder);
      append(holder, node);
    },
  };

  if (dismissable) {
    append(
      el,
      IconButton({
        icon: "x",
        label: "关闭",
        cls: "dialog-close",
        onClick: () => api.close(null),
      })
    );
    overlay.addEventListener("click", () => api.close(null));
  }

  const onKey = (e) => {
    if (e.key === "Escape" && dismissable && dialogStack[dialogStack.length - 1] === api) {
      e.preventDefault();
      e.stopPropagation();
      api.close(null);
      return;
    }
    if (e.key === "Tab" && dialogStack[dialogStack.length - 1] === api) {
      const focusables = qsa(
        'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),a[href]',
        el
      ).filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  document.body.style.overflow = "hidden";
  document.body.appendChild(overlay);
  document.body.appendChild(el);
  document.addEventListener("keydown", onKey, true);
  dialogStack.push(api);
  onOpen?.(api);
  requestAnimationFrame(() => {
    const target =
      qs("[data-autofocus]", el) ||
      qs("input.input,textarea.input", el) ||
      qs(".dialog-footer .btn", el) ||
      qs("button", el);
    target?.focus();
  });
  return api;
}

export function confirmDialog({ title = "确认操作", description, confirmLabel = "确认", cancelLabel = "取消", variant = "default", danger = false, body }) {
  return new Promise((resolve) => {
    const api = openDialog({
      title,
      description,
      size: "sm",
      body: body || null,
      footer: frag(
        Button({ label: cancelLabel, variant: "ghost", onClick: () => api.close(false) }),
        Button({
          label: confirmLabel,
          variant: danger ? "destructive" : variant === "default" ? "primary" : variant,
          onClick: () => api.close(true),
        })
      ),
      onClose: (v) => resolve(!!v),
    });
  });
}

export function promptDialog({ title = "请输入", description, value = "", placeholder, confirmLabel = "确定", validate, multiline }) {
  return new Promise((resolve) => {
    let api;
    const errorEl = h("div.field-hint.destructive-text.hidden");
    const input = multiline
      ? h("textarea.input", { value, placeholder, rows: 3, spellcheck: false })
      : Input({ value, placeholder, autofocus: true });
    const submit = () => {
      const v = input.value.trim();
      if (validate) {
        const err = validate(v);
        if (err) {
          errorEl.textContent = err;
          errorEl.classList.remove("hidden");
          input.focus();
          return;
        }
      }
      api.close(v);
      resolve(v);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !multiline) {
        e.preventDefault();
        submit();
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && multiline) {
        e.preventDefault();
        submit();
      }
    });
    api = openDialog({
      title,
      description,
      size: "sm",
      body: h("div.col.gap-2", input, errorEl),
      footer: frag(
        Button({ label: "取消", variant: "ghost", onClick: () => api.close(null) }),
        Button({ label: confirmLabel, variant: "primary", onClick: submit })
      ),
      onClose: (v) => resolve(v ?? null),
    });
    setTimeout(() => input.focus(), 30);
  });
}

/* ====================================================================== *
 * Toast
 * ====================================================================== */

let toastViewport = null;
function viewport() {
  if (!toastViewport || !toastViewport.isConnected) {
    toastViewport = h("div.toast-viewport", { role: "region", "aria-label": "通知" });
    document.body.appendChild(toastViewport);
  }
  return toastViewport;
}

const ICON_FOR_VARIANT = {
  default: "info",
  success: "circle-check",
  destructive: "circle-x",
  warning: "alert-triangle",
  info: "info",
};

/**
 * toast({ title, description, variant, duration, actions:[{label,onClick,variant}], icon })
 * Returns a dismiss function.
 */
export function toast({ title, description, variant = "default", duration = 4200, actions = [], icon } = {}) {
  const id = uid("toast");
  let timer;
  const el = h(
    "div.toast",
    { dataset: { id }, role: "status" },
    ico(icon || ICON_FOR_VARIANT[variant] || "info", 16, `shrink-0 ${variant === "destructive" ? "destructive-text" : ""}`),
    h(
      "div.flex-1.col.gap-1",
      title ? h("div.toast-title", title) : null,
      description ? h("div.toast-desc", description) : null,
      actions.length
        ? h(
            "div.toast-actions",
            actions.map((a) => Button({ label: a.label, variant: a.variant || "outline", size: "xs", onClick: () => { a.onClick?.(); dismiss(); } }))
          )
        : null
    ),
    IconButton({ icon: "x", label: "关闭提示", size: "xs", onClick: () => dismiss() })
  );

  const dismiss = () => {
    clearTimeout(timer);
    if (!el.isConnected) return;
    el.dataset.leaving = "true";
    setTimeout(() => el.remove(), 150);
  };

  viewport().appendChild(el);
  if (duration > 0) timer = setTimeout(dismiss, duration);
  el.addEventListener("mouseenter", () => clearTimeout(timer));
  el.addEventListener("mouseleave", () => {
    if (duration > 0) timer = setTimeout(dismiss, 1400);
  });
  return dismiss;
}

/* ====================================================================== *
 * Tooltip (delegated, driven by data-tip)
 * ====================================================================== */

let tipEl = null;
let tipTimer = null;
let tipInstalled = false;

export function installTooltips(root = document) {
  if (tipInstalled && root === document) return;
  const show = (target) => {
    const text = target.dataset.tip;
    if (!text || target.disabled) return;
    hideTip();
    tipEl = h("div.tooltip", { role: "tooltip" }, text);
    document.body.appendChild(tipEl);
    const r = target.getBoundingClientRect();
    const tw = tipEl.offsetWidth;
    const th = tipEl.offsetHeight;
    let left = clamp(r.left + r.width / 2 - tw / 2, 8, innerWidth - tw - 8);
    let top = r.top - th - 6;
    if (top < 8) top = r.bottom + 6;
    tipEl.style.left = `${Math.round(left)}px`;
    tipEl.style.top = `${Math.round(top)}px`;
  };
  const hideTip = () => {
    clearTimeout(tipTimer);
    tipEl?.remove();
    tipEl = null;
  };

  root.addEventListener(
    "pointerover",
    (e) => {
      const target = e.target.closest?.("[data-tip]");
      if (!target) return;
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => show(target), 420);
    },
    true
  );
  root.addEventListener("pointerout", (e) => {
    if (e.target.closest?.("[data-tip]")) hideTip();
  }, true);
  root.addEventListener("pointerdown", hideTip, true);
  window.addEventListener("scroll", hideTip, true);
  window.addEventListener("blur", hideTip);
  if (root === document) tipInstalled = true;
}

/* ====================================================================== *
 * Tabs
 * ====================================================================== */

export function Tabs({ items, value, onChange, variant = "pill", cls }) {
  const list = h("div", { class: variant === "underline" ? `tabs-underline ${cls || ""}` : `tabs-list ${cls || ""}`, role: "tablist" });
  const render = () => {
    clear(list);
    for (const item of items) {
      list.appendChild(
        h(
          `button.${variant === "underline" ? "tab-underline" : "tabs-trigger"}`,
          {
            type: "button",
            role: "tab",
            "aria-selected": String(item.id === value),
            title: item.hint || item.label,
            onClick: () => {
              if (item.id === value) return;
              value = item.id;
              render();
              onChange?.(item.id, item);
            },
          },
          item.icon ? ico(item.icon, 14) : null,
          item.label,
          item.count != null ? h("span.badge.badge-muted", { style: { marginLeft: "2px" } }, String(item.count)) : null
        )
      );
    }
  };
  render();
  list.setValue = (v) => {
    value = v;
    render();
  };
  return list;
}

/* ====================================================================== *
 * Theme
 * ====================================================================== */

export function applyTheme(pref = "system") {
  // dev-only override so every surface can be screenshotted in either theme
  // without a browser profile; never active inside the real extension.
  const forced = globalThis.__MOCK_CHROME__
    ? new URLSearchParams(location.search).get("theme")
    : null;
  const want = forced || pref;
  const dark = want === "dark" || (want === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  return dark;
}

export function watchTheme(pref, cb) {
  applyTheme(pref);
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const listener = () => cb?.(applyTheme(pref));
  mq.addEventListener("change", listener);
  return () => mq.removeEventListener("change", listener);
}

/* ====================================================================== *
 * Sortable list (HTML5 DnD with a drop indicator)
 * ====================================================================== */

/**
 * makeSortable(container, {
 *   selector: ".item",           // draggable children
 *   handle: ".grip",             // optional; whole row drags when omitted
 *   canDrag: (el) => bool,
 *   onDrop: ({ item, from, to, targetId, position }) => void
 * })
 */
export function makeSortable(container, opts = {}) {
  const selector = opts.selector || "[data-sortable]";
  let dragEl = null;
  let line = null;
  let fromIndex = -1;

  const items = () => [...container.querySelectorAll(selector)];

  const ensureLine = () => {
    if (!line) line = h("div.drop-line");
    return line;
  };

  container.addEventListener("dragstart", (e) => {
    const el = e.target.closest?.(selector);
    if (!el || !container.contains(el)) return;
    if (opts.handle && !e.target.closest(opts.handle)) {
      e.preventDefault();
      return;
    }
    if (opts.canDrag && !opts.canDrag(el)) {
      e.preventDefault();
      return;
    }
    dragEl = el;
    fromIndex = items().indexOf(el);
    el.dataset.dragging = "true";
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", el.dataset.id || String(fromIndex));
    } catch {
      /* some browsers restrict setData during dragstart */
    }
  });

  container.addEventListener("dragover", (e) => {
    if (!dragEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const over = e.target.closest?.(selector);
    const l = ensureLine();
    if (!over || over === dragEl) {
      l.remove();
      return;
    }
    const r = over.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    container.appendChild(l);
    l.style.left = "0";
    l.style.right = "0";
    l.style.top = `${before ? over.offsetTop - 1 : over.offsetTop + over.offsetHeight - 1}px`;
    l.dataset.before = String(before);
    l.dataset.target = over.dataset.id || "";
  });

  container.addEventListener("dragleave", (e) => {
    if (e.relatedTarget && container.contains(e.relatedTarget)) return;
    line?.remove();
  });

  container.addEventListener("drop", (e) => {
    if (!dragEl) return;
    e.preventDefault();
    const over = e.target.closest?.(selector);
    const list = items();
    const targetIndex = over ? list.indexOf(over) : list.length - 1;
    const before = line?.dataset.before !== "false";
    let to = targetIndex + (before ? 0 : 1);
    if (fromIndex > -1 && to > fromIndex) to -= 1;
    const payload = {
      item: dragEl,
      from: fromIndex,
      to: clamp(to, 0, Math.max(0, list.length - 1)),
      targetId: over?.dataset.id || null,
      position: before ? "before" : "after",
      transfer: e.dataTransfer,
    };
    line?.remove();
    dragEl.dataset.dragging = "false";
    dragEl = null;
    opts.onDrop?.(payload, e);
  });

  container.addEventListener("dragend", () => {
    line?.remove();
    if (dragEl) dragEl.dataset.dragging = "false";
    dragEl = null;
  });

  return {
    destroy() {
      line?.remove();
    },
  };
}

/* ====================================================================== *
 * Misc helpers
 * ====================================================================== */

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = h("textarea", { style: { position: "fixed", opacity: "0" }, value: text });
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand?.("copy");
  ta.remove();
  return ok ? Promise.resolve() : Promise.reject(new Error("copy failed"));
}

/**
 * Global hotkey registry. Combos look like "mod+k", "escape", "alt+shift+t".
 * Values are either a handler or { fn, allowTyping }. Plain keys are ignored
 * while the user is typing in a field; Escape is always allowed through.
 */
export function hotkeys(map, target = window) {
  const normalize = (e) => {
    const parts = [];
    if (e.metaKey || e.ctrlKey) parts.push("mod");
    if (e.altKey) parts.push("alt");
    if (e.shiftKey) parts.push("shift");
    parts.push(e.key.toLowerCase());
    return parts.join("+");
  };
  const handler = (e) => {
    const combo = normalize(e);
    const entry = map[combo];
    if (!entry) return;
    const fn = typeof entry === "function" ? entry : entry.fn;
    const allowTyping = typeof entry === "object" && entry.allowTyping;
    const t = e.target;
    const typing = t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    if (typing && !allowTyping && combo !== "escape") return;
    fn(e);
  };
  target.addEventListener("keydown", handler);
  return () => target.removeEventListener("keydown", handler);
}

export function relativePosition(anchor, width, height) {
  const r = anchor.getBoundingClientRect();
  return {
    left: clamp(r.left, 8, innerWidth - width - 8),
    top: r.bottom + height > innerHeight - 8 ? Math.max(8, r.top - height - 4) : r.bottom + 4,
  };
}

export function startCountUp(el, to, duration = 500, format = (n) => String(Math.round(n))) {
  const from = Number(el.dataset.count || 0);
  const t0 = performance.now();
  const step = (t) => {
    const p = clamp((t - t0) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = format(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(step);
    else el.dataset.count = String(to);
  };
  requestAnimationFrame(step);
}
