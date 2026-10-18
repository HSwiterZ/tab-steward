/**
 * The module registry — the single source of truth for "is this feature on".
 *
 * Every entry is consumed by every surface that exposes the feature (dashboard
 * nav + toolbar, context menu, popup, the ⌘K palette, the side panel, the
 * service worker's background work), so turning a module off has to remove all
 * of it, not just one button. Turning it off never deletes data: the alarms stop
 * and the entries disappear, and re-enabling restores the same view.
 *
 * `core: true` modules are the ground this extension stands on: open-tab
 * management, the 暂存区, and the usage accounting that idle scoring and every
 * sort order are computed from. They cannot be disabled.
 */
export const MODULES = [
  { id: "tabs", label: "已开标签管理", core: true, surfaces: "标签列表、排序、聚焦、关闭、移动、固定、静音" },
  { id: "stash", label: "暂存区", core: true, surfaces: "右栏暂存区、暂存到暂存区、批量暂存" },
  { id: "analytics", label: "使用分析", core: true, surfaces: "前台时长与激活采集、闲置度、分析视图。闲置度与全部排序都依赖这份采集，所以不可关闭" },

  { id: "favorites", label: "收藏区", defaultOn: true, surfaces: "自定义收藏区、「收藏到…」、归档为书签" },
  { id: "duplicates", label: "重复标签治理", defaultOn: true, surfaces: "发现重复时的提示与关闭/跳转选择、清理重复入口、重复徽标" },
  { id: "sleep", label: "休眠", defaultOn: true, surfaces: "手动休眠、自动休眠策略、站点保护、右键「休眠此标签」" },
  { id: "reminders", label: "定时提醒", defaultOn: true, surfaces: "提醒视图、闹钟、角标、系统通知、Dashboard 横幅、右键「设定提醒」" },
  { id: "snapshots", label: "工作区快照", defaultOn: true, surfaces: "快照视图、保存/恢复窗口布局" },
  { id: "organize", label: "自动整理", defaultOn: true, surfaces: "同站点相邻、按收藏区建标签组、整理建议、右键「整理所有标签」" },
  { id: "library", label: "书签与历史检索", defaultOn: true, surfaces: "统一搜索里的书签 / 历史 / 最近关闭来源、书签历史面板" },
  { id: "trash", label: "回收站与备份", defaultOn: true, surfaces: "回收站视图、导出导入、30 天自动清理" },

  { id: "llm", label: "LLM 整理助手", defaultOn: false, surfaces: "Dashboard 工具栏的「让助手整理」入口与设置分组。需要自备模型服务地址与密钥" },
  { id: "screenshotPreview", label: "标签悬停截图", defaultOn: false, surfaces: "在 Dashboard 悬停标签时显示该页缓存截图。需要按需授予网页访问权限" },
];

export const MODULE_IDS = MODULES.map((m) => m.id);
export const CORE_MODULE_IDS = MODULES.filter((m) => m.core).map((m) => m.id);

/** id -> default enabled state, used to seed settings.modules. */
export function defaultModules() {
  const out = {};
  for (const m of MODULES) out[m.id] = m.core || m.defaultOn === true;
  return out;
}

export function moduleById(id) {
  return MODULES.find((m) => m.id === id) || null;
}

/** Core modules are always on; anything else follows settings.modules. */
export function isOn(settings, id) {
  if (CORE_MODULE_IDS.includes(id)) return true;
  const modules = settings?.modules;
  if (modules && typeof modules === "object" && id in modules) return modules[id] !== false;
  return moduleById(id)?.defaultOn === true;
}

/** Modules the user switched off — used by the settings page and diagnostics. */
export function disabledModules(settings) {
  return MODULES.filter((m) => !m.core && !isOn(settings, m.id)).map((m) => m.id);
}
