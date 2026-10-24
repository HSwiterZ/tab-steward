/**
 * Fluent Emoji (MIT, https://github.com/microsoft/fluentui-emoji), pulled from
 * Iconify's fluent-emoji set. Kept as standalone SVG files instead of inline
 * markup: the colour glyphs are 6-16 KB each and their gradients/filters carry
 * ids, so inlining several would both bloat the JS and risk id collisions.
 * Used by the global action rows, the row-level verbs, the menus and the
 * sleeping badge; structural chrome and state chips stay on the Phosphor
 * duotone table in icons.js.
 */

const FILES = new Set([
  "alarm-clock",
  "bar-chart",
  "bookmark-tabs",
  "bullseye",
  "card-index-dividers",
  "crescent-moon",
  "file-cabinet",
  "gear",
  "house",
  "inbox-tray",
  "left-right-arrow",
  "locked",
  "magnifying-glass-tilted-left",
  "package",
  "play-button",
  "shield",
  "sun",
  "zzz",
]);

export function emojiSrc(name) {
  const file = FILES.has(name) ? name : "sun";
  return chrome.runtime.getURL(`assets/emoji/${file}.svg`);
}

export function emojiImg(name, size = 22) {
  const img = document.createElement("img");
  img.src = emojiSrc(name);
  img.width = size;
  img.height = size;
  img.alt = "";
  img.className = "emoji-icon";
  img.dataset.emoji = name;
  img.draggable = false;
  img.style.width = `${size}px`;
  img.style.height = `${size}px`;
  return img;
}
