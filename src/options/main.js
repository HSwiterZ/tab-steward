import { h, ico, append, toast, Button, IconButton, Switch, Select, Input, Badge, watchTheme, installTooltips, confirmDialog } from "../ui/kit.js";
import { store } from "../core/storage.js";
import { MODULES, isOn } from "../core/modules.js";
import { configIssues, isConfigured } from "../core/llm.js";
import { hasCapturePermission } from "../background/screenshots.js";
import { describePolicy } from "../background/sleep.js";

await store.ready;
installTooltips();

const root = document.getElementById("root");
const get = (path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), store.get("settings"));
const set = async (path, value) => {
  const keys = path.split(".");
  const patch = {};
  let cursor = patch;
  for (let i = 0; i < keys.length - 1; i++) {
    cursor[keys[i]] = cursor[keys[i]] || {};
    cursor = cursor[keys[i]];
  }
  cursor[keys[keys.length - 1]] = value;
  await store.patch("settings", patch);
};

watchTheme(get("theme") || "system");
store.on("settings", (next) => watchTheme(next?.theme || "system"));

/* ------------------------------------------------------------------ */

function row(title, desc, control, extra) {
  return h(
    "div.setting-row",
    h("div.setting-main", h("div.setting-title", title, extra || null), desc ? h("div.setting-desc", desc) : null),
    h("div.setting-control", control)
  );
}

function toggle(path, label, desc, opts = {}) {
  const sw = Switch({
    checked: !!get(path),
    label,
    onChange: async (on) => {
      if (opts.before) {
        const ok = await opts.before(on);
        if (!ok) return;
      }
      await set(path, on);
      if (opts.after) opts.after(on);
      toast({ title: `${label}：${on ? "已开启" : "已关闭"}`, duration: 1600 });
    },
  });
  return row(label, desc, sw);
}

function numberField(path, label, desc, { min = 1, max = 10000, step = 1, suffix = "" } = {}) {
  const input = h("input.input.input-sm", {
    type: "number",
    value: String(get(path) ?? ""),
    min,
    max,
    step,
    style: { width: "92px" },
    onChange: async (e) => {
      const v = Number(e.target.value);
      if (!Number.isFinite(v)) return;
      await set(path, Math.max(min, Math.min(max, v)));
      if (suffix === "minutes-sleep") refreshSleepHint();
    },
  });
  return row(label, desc, h("div.row.gap-1", input, suffix && suffix !== "minutes-sleep" ? h("span.muted.text-xs", suffix) : null, suffix === "minutes-sleep" ? h("span.muted.text-xs", "分钟") : null));
}

function selectField(path, label, desc, options) {
  return row(
    label,
    desc,
    Select({
      value: String(get(path)),
      options,
      onChange: (v) => set(path, v),
    })
  );
}

function section(icon, title, desc, ...children) {
  return h(
    "section.col",
    h("div.section-title", ico(icon, 15), title),
    desc ? h("div.muted.text-xs", { style: { marginBottom: "6px" } }, desc) : null,
    h("div.card", h("div.card-content", { style: { padding: "0 16px" } }, ...children))
  );
}

/** A section that only exists while its module is on — no configuring dead switches. */
function gated(visible, ...args) {
  return visible ? section(...args) : null;
}

const permBadge = h("span");
async function refreshPerm() {
  const ok = await hasCapturePermission();
  permBadge.innerHTML = "";
  append(permBadge, ok ? Badge({ label: "已授予 <all_urls>", variant: "success" }) : Badge({ label: "未授予主机权限", variant: "outline" }));
}

/** One row per module. Core rows are switches rendered disabled, with the reason. */
function moduleRows(on) {
  return MODULES.map((m) => {
    if (m.core) {
      return row(m.label, `核心能力，不可关闭。${m.surfaces}`, Badge({ label: "始终开启", variant: "secondary" }));
    }
    return toggle(
      `modules.${m.id}`,
      m.label,
      m.surfaces,
      m.id === "screenshotPreview"
        ? {
            before: async (want) => {
              if (!want) return true;
              if (!chrome.permissions?.request) {
                toast({ title: "当前环境不支持申请权限", variant: "destructive" });
                return false;
              }
              const granted = await chrome.permissions.request({ origins: ["<all_urls>"] });
              if (!granted) toast({ title: "未授予权限，截图预览保持关闭", variant: "warning" });
              return granted;
            },
            after: () => refreshPerm(),
          }
        : {}
    );
  });
}

/* ------------------------------------------------------------------ */

const sleepHint = h("div.setting-desc", { style: { marginTop: "6px" } });
async function refreshSleepHint() {
  try {
    const p = await describePolicy();
    sleepHint.textContent = p.enabled
      ? `当前策略：闲置超过 ${p.idleMinutes} 分钟的标签会被休眠；现在符合条件的有 ${p.wouldSleep} 个，跳过 ${p.wouldSkip} 个。每 ${p.checkEveryMinutes} 分钟检查一次。`
      : "自动休眠已关闭。你仍可以手动休眠标签。";
  } catch {
    sleepHint.textContent = "";
  }
}

async function build() {
  const wrap = h("div.options-wrap");
  const on = (id) => isOn(store.get("settings"), id);

  /* 功能模块 */
  append(
    wrap,
    section(
      "sliders",
      "功能模块",
      "关闭一个模块会同时撤掉它在弹窗、Dashboard、右键菜单、统一搜索与设置页里的全部入口，并停止它的后台工作；数据一律保留，重新开启即恢复原样。",
      ...moduleRows(on)
    )
  );

  /* 通知 */
  append(
    wrap,
    section(
      "bell",
      "通知",
      "提醒与重复标签通知共用这里的设置。",
      toggle("notifications.sticky", "通知留在屏幕上", "不留在屏幕上时，Windows 可能在你看到之前就收起通知，「关闭这个并跳转」「续时 10 分钟」两个按钮也就来不及点。")
    )
  );

  /* 外观 */
  append(
    wrap,
    section(
      "sun",
      "外观与入口",
      "",
      selectField("theme", "主题", "跟随系统会在深浅色之间自动切换。", [
        { value: "system", label: "跟随系统" },
        { value: "light", label: "浅色" },
        { value: "dark", label: "深色" },
      ]),
      selectField("newtab.mode", "新标签页", "默认显示极简起始页；完整 Dashboard 会占用更多内存。", [
        { value: "minimal", label: "极简起始页（默认）" },
        { value: "dashboard", label: "完整 Dashboard" },
      ]),
      toggle("newtab.minimalGreeting", "显示问候语", "极简起始页顶部按时间段问候。"),
      numberField("newtab.minimalShowRecent", "起始页常去站点数量", "极简起始页展示的磁贴个数。", { min: 0, max: 12 })
    )
  );

  /* 重复标签 */
  append(
    wrap,
    gated(on("duplicates"),
      "copy",
      "重复标签治理",
      "默认开启。打开与已有标签完全相同网址的页面时提示，由你决定关掉这个还是两个都留。",
      toggle("duplicateWarning", "重复标签提示", "发现与已有标签完全相同的网址时提醒。关掉后只保留手动清理入口，不再打扰。")
    )
  );

  /* 休眠 */
  append(
    wrap,
    gated(on("sleep"),
      "moon",
      "休眠与保护",
      "休眠保留标签但释放渲染进程内存。默认 120 分钟自动休眠。",
      toggle("autoSleep.enabled", "自动休眠", "按下面的阈值周期性休眠闲置标签。", { after: () => refreshSleepHint() }),
      numberField("autoSleep.idleMinutes", "闲置阈值", "超过该时长未使用的标签会被休眠。", { min: 5, max: 720, suffix: "minutes-sleep" }),
      numberField("autoSleep.checkEveryMinutes", "检查间隔", "后台检查频率（分钟）。", { min: 1, max: 120, suffix: "分钟" }),
      toggle("autoSleep.skipActive", "跳过正在使用的标签", ""),
      toggle("autoSleep.skipPinned", "跳过固定标签", ""),
      toggle("autoSleep.skipAudible", "跳过正在播放声音的标签", ""),
      toggle("autoSleep.skipAlreadyDiscarded", "跳过已休眠标签", ""),
      toggle("autoSleep.skipProtected", "跳过受保护站点", "在 Dashboard 里可以把站点标记为受保护。"),
      toggle("autoSleep.notify", "休眠后发送系统通知", ""),
      sleepHint
    )
  );

  /* LLM */
  const llmIssues = configIssues();
  const llmStatus = h("div.setting-desc", llmIssues.length ? `尚未配置：${llmIssues.join("；")}` : "已配置，可在 Dashboard 使用助手。");
  const testResult = h("div.setting-desc");

  const baseUrlInput = Input({ value: get("llm.baseUrl") || "", placeholder: "https://api.example.com 或 http://127.0.0.1:1234/v1", onInput: (v) => set("llm.baseUrl", v) });
  const keyInput = h("input.input.input-sm", { type: "password", value: get("llm.apiKey") || "", placeholder: "留空则不发送 Authorization 头", autocomplete: "off", onInput: (e) => set("llm.apiKey", e.target.value) });
  const modelInput = Input({ value: get("llm.model") || "", placeholder: "例如 gpt-4o-mini / qwen-plus", onInput: (v) => set("llm.model", v) });

  append(
    wrap,
    gated(on("llm"),
      "sparkles",
      "LLM 助手",
      "默认关闭。只把标签的标题、域名、闲置分钟数和状态发给模型；网址、历史与统计都留在本地。",
      row("服务地址 Base URL", "兼容 OpenAI /chat/completions 协议；可填到 /v1 一级。", baseUrlInput),
      row("API Key", "仅保存在本机 chrome.storage.local，不会写入代码或上传到别处。", keyInput),
      row("模型名", "", modelInput),
      numberField("llm.temperature", "温度", "越低越稳定。", { min: 0, max: 2, step: 0.1 }),
      numberField("llm.timeoutMs", "超时", "毫秒。", { min: 5000, max: 180000, suffix: "ms" }),
      row(
        "连接测试",
        "调用 GET /models 验证地址与 Key 是否可用，不会发送标签数据。",
        Button({
          label: "测试连接",
          icon: "zap",
          size: "sm",
          variant: "outline",
          onClick: async () => {
            testResult.textContent = "测试中…";
            const base = String(get("llm.baseUrl") || "").trim().replace(/\/+$/, "");
            if (!base) {
              testResult.textContent = "请先填写 Base URL。";
              return;
            }
            const url = /\/v\d+$/.test(base) ? `${base}/models` : `${base}/v1/models`;
            try {
              const res = await fetch(url, { headers: get("llm.apiKey") ? { Authorization: `Bearer ${get("llm.apiKey")}` } : {} });
              testResult.textContent = res.ok ? `连接成功（${res.status}）` : `返回 ${res.status} ${res.statusText}`;
            } catch (err) {
              testResult.textContent = `连接失败：${err?.message || err}`;
            }
          },
        }),
        testResult
      ),
      row("配置状态", "", h("div.col", llmStatus, isConfigured() ? Badge({ label: "可用", variant: "success" }) : Badge({ label: "待配置", variant: "warning" })))
    )
  );

  /* 悬停截图：开关在上方「功能模块」里，打开时在那里申请截屏权限 */
  refreshPerm();
  append(
    wrap,
    gated(on("screenshotPreview"),
      "camera",
      "标签悬停截图",
      "切换标签时截取当前可见页并缓存在本机，悬停标签时显示。",
      row("截屏权限", "用于 chrome.tabs.captureVisibleTab。", h("div.row.gap-2", permBadge, Button({ label: "撤销权限", size: "xs", variant: "ghost", onClick: async () => { await chrome.permissions?.remove?.({ origins: ["<all_urls>"] }); refreshPerm(); } }))),
      numberField("experimental.screenshotMaxAgeMinutes", "截图缓存有效期", "超过该时间的截图不再展示。", { min: 1, max: 240, suffix: "分钟" })
    )
  );

  /* 提醒 */
  append(
    wrap,
    gated(on("reminders"),
      "bell",
      "提醒",
      "",
      toggle("reminders.systemNotification", "系统通知", ""),
      toggle("reminders.badge", "扩展角标", "到点的提醒数量显示在工具栏图标上。"),
      toggle("reminders.dashboardBanner", "Dashboard 横幅", ""),
      numberField("reminders.defaultOffsetMinutes", "默认提醒时长", "新建提醒时默认选中的分钟数。", { min: 1, max: 1440, suffix: "分钟" })
    )
  );

  /* 整理 */
  append(
    wrap,
    gated(on("organize"),
      "wand",
      "自动整理",
      "",
      toggle("organize.autoGroupByCollection", "收藏时同步 Chrome 分组", "把标签加入收藏区时，顺手把它归入同名 Chrome 标签组。"),
      toggle("organize.groupColorCycle", "分组颜色按名称固定", "同名分组始终使用同一种颜色。")
    )
  );

  /* 数据 */
  append(
    wrap,
    section(
      "database",
      "数据",
      "回收站保留 30 天；备份为 JSON，导入前会预览校验。",
      on("trash") &&
      row(
        "回收站与备份",
        "在 Dashboard 的「回收站与备份」里导出、导入、恢复。",
        Button({ label: "打开 Dashboard", icon: "external-link", size: "sm", variant: "outline", onClick: () => chrome.runtime.sendMessage({ type: "dashboard:open", payload: { hash: "data" } }) })
      ),
      row(
        "重置所有数据",
        "清空本地存储并恢复默认设置。此操作不可撤销。",
        Button({
          label: "重置…",
          icon: "trash",
          size: "sm",
          variant: "destructive",
          onClick: async () => {
            const ok = await confirmDialog({ title: "重置所有数据？", description: "收藏、快照、统计、提醒都会被清空，设置恢复默认。", confirmLabel: "全部重置", danger: true });
            if (!ok) return;
            await store.clearAll();
            toast({ title: "已重置", variant: "success" });
            location.reload();
          },
        })
      )
    )
  );

  root.innerHTML = "";
  append(root, h("div.col", { style: { padding: "24px 16px 8px", maxWidth: "760px", margin: "0 auto" } }, h("div.row.gap-2", { style: { marginBottom: "8px" } }, h("img", { src: chrome.runtime.getURL("assets/icon48.png"), style: { width: "26px", height: "26px", borderRadius: "7px" } }), h("div.text-xl.font-semibold", "设置")), wrap));

  refreshSleepHint();
}

await build();

let modulesSignature = JSON.stringify(store.get("settings")?.modules || {});
store.on("settings", () => {
  /* keep derived hints fresh without a full rebuild while typing */
  refreshSleepHint();
  // A module flip changes which sections exist at all, so rebuild the page.
  const sig = JSON.stringify(store.get("settings")?.modules || {});
  if (sig !== modulesSignature) {
    modulesSignature = sig;
    build();
  }
});
