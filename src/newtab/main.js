import { h, ico, append, installTooltips, watchTheme, IconButton } from "../ui/kit.js";
import { Favicon, openPalette, paletteHint } from "../ui/shared.js";
import { store } from "../core/storage.js";
import { formatClock, formatDate, hostname } from "../core/utils.js";

await store.ready;

const settings = store.get("settings") || {};
watchTheme(settings.theme || "system");
store.on("settings", (next) => {
  watchTheme(next?.theme || "system");
  if (next?.newtab?.mode === "dashboard" && !document.querySelector(".app")) location.reload();
});
installTooltips();

if ((settings.newtab?.mode || "minimal") === "dashboard") {
  await import("../dashboard/main.js");
} else {
  renderMinimal();
}

function renderMinimal() {
  const root = document.getElementById("root");
  const clock = h("div.newtab-clock", "--:--");
  const date = h("div.newtab-date");

  const tick = () => {
    const d = new Date();
    clock.textContent = formatClock(d.getTime());
    const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
    date.textContent = `${formatDate(d.getTime())} ${weekday}`;
  };
  tick();
  setInterval(tick, 1000);

  const searchBox = h(
    "button.search-trigger.newtab-search",
    {
      style: { height: "42px", fontSize: "13.5px", background: "hsl(var(--card))", borderRadius: "10px" },
      onClick: () => openPalette({ onPick: (item) => openItem(item) }),
    },
    ico("search", 16),
    h("span.muted", paletteHint()),
    h("span.kbd", "Enter")
  );

  const tiles = h("div.newtab-recent");
  buildTiles(tiles);

  const greet = settings.newtab?.minimalGreeting !== false ? greeting() : "";

  append(
    root,
    h(
      "div.newtab-min",
      h(
        "div.row.gap-2",
        { style: { position: "fixed", top: "16px", right: "16px" } },
        IconButton({ icon: "layout-dashboard", label: "打开 Dashboard", onClick: () => chrome.runtime.sendMessage({ type: "dashboard:open" }) }),
        IconButton({ icon: "settings", label: "设置", onClick: () => chrome.runtime.openOptionsPage?.() })
      ),
      greet ? h("div.text-lg.muted", greet) : null,
      h("div.col", { style: { alignItems: "center" } }, clock, date),
      searchBox,
      tiles
    )
  );

  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement === document.body) {
      e.preventDefault();
      openPalette({ onPick: openItem });
    }
  });
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "夜深了，记得让标签也休息。";
  if (hour < 11) return "早上好。";
  if (hour < 14) return "中午好。";
  if (hour < 18) return "下午好。";
  return "晚上好。";
}

async function buildTiles(container) {
  const stats = Object.values(store.get("stats") || {})
    .filter((s) => s.url && !/^(chrome|edge|about):/.test(s.url))
    .sort((a, b) => (b.lastVisitAt || 0) - (a.lastVisitAt || 0));
  const seen = new Set();
  const picks = [];
  for (const s of stats) {
    const host = hostname(s.url);
    if (seen.has(host)) continue;
    seen.add(host);
    picks.push(s);
    if (picks.length >= (store.get("settings") || {}).newtab?.minimalShowRecent || picks.length >= 6) break;
  }
  if (!picks.length) return;
  for (const s of picks) {
    append(
      container,
      h(
        "button.newtab-tile",
        { onClick: () => chrome.tabs.create({ url: s.url, active: true }) },
        Favicon({ url: s.url, size: 28 }),
        h("span", hostname(s.url))
      )
    );
  }
}

async function openItem(item) {
  if (item.source === "tab") {
    await chrome.windows.update(item.payload.windowId, { focused: true }).catch(() => {});
    await chrome.tabs.update(item.payload.tabId, { active: true });
  } else if (item.source === "closed") {
    await chrome.sessions.restore(item.payload.sessionId);
  } else {
    await chrome.tabs.create({ url: item.url, active: true });
  }
}
