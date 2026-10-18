# Tab Steward — Chrome 标签管理器

[![check](https://github.com/HSwiterZ/tab-steward/actions/workflows/ci.yml/badge.svg)](https://github.com/HSwiterZ/tab-steward/actions/workflows/ci.yml)

[English](README.md) · **简体中文** · [日本語](README.ja.md) · [한국어](README.ko.md)

Manifest V3 扩展，零构建、零依赖：全部代码为原生 ES Module，直接「加载已解压的扩展程序」即可运行。

<table>
  <tr>
    <td><img src="docs/screenshots/dashboard-tabs.png" width="430" alt="Dashboard：按窗口分组的站点卡片"></td>
    <td><img src="docs/screenshots/dashboard-analytics.png" width="430" alt="使用分析：站点前台时长排行"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/dashboard-tabs-dark.png" width="430" alt="Dashboard 暗色"></td>
    <td><img src="docs/screenshots/popup.png" width="270" alt="工具栏弹窗"></td>
  </tr>
</table>

> **界面目前只有中文。** 文档有英/日/韩版本，界面还没有。

Tab Steward 会量出每个标签已经闲置多久，把陈旧的休眠掉，把成组标签暂存进命名收藏区，处理重复标签，
对整个工作区做快照与恢复，挂定时提醒，并把标签 / 暂存 / 书签 / 历史 / 最近关闭收进同一个
`Ctrl`/`⌘K` 搜索面板。除「已开标签管理」「暂存区」「使用分析」三项核心能力外，其余功能都能关掉。
所有数据只留在本机 `chrome.storage.local`；可选的 LLM 助手默认关闭，且只与你填写的 Base URL 通信。
图标与样式的来源见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

## 安装

1. 打开 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本目录
4. 工具栏出现图标即完成；点击图标打开弹窗，`Alt+Shift+T` 打开 Dashboard

## 入口

| 入口 | 位置 | 说明 |
|---|---|---|
| 工具栏弹窗 | `src/popup/` | 统一搜索（标签/暂存/书签/历史/最近关闭）；下方分「当前标签 / 暂存区」两栏；按站点折叠、暂存/休眠/关闭、重复清理 |
| Dashboard | `src/dashboard/` | 顶栏 = 图标 + 搜索栏 + 常用功能按钮；主区 = 当前标签（排序/按窗口分组/筛选 chips/窗口分区/站点卡片）；右栏 = 常驻收藏区面板；提醒、快照、分析、回收站通过顶栏图标切换 |
| 新标签页 | `src/newtab/` | 默认极简起始页；可在设置中切换为完整 Dashboard |
| 设置 | `src/options/` | 全部开关与 LLM 配置 |

快捷键：`Alt+T` 弹窗、`Alt+Shift+T` Dashboard、`Ctrl/⌘+K` 统一搜索。

网页右键会出现一个「Tab Steward — 标签页管理器」总入口，内含子菜单：设定提醒（预设时长）、
暂存到…、暂存并关闭到…（均列出全部收藏区）、休眠此标签、移动到窗口（列出普通窗口）、
整理所有标签（站点相邻 + 收藏区分组），以及保护站点开关。子菜单内容随收藏区与窗口变化自动重建。

## 功能模块与默认开关

除「已开标签管理」「暂存区」「使用分析」三个核心能力外，其余功能都是可关模块，开关集中在设置页顶部的
「功能模块」清单里（唯一事实来源：`src/core/modules.js`）。**关闭一个模块会同时撤掉它在弹窗、
Dashboard、右键菜单、统一搜索与设置页里的全部入口，并停止它的后台工作；数据一律保留，重新开启即恢复。**

使用分析属于核心：闲置度和 Dashboard 的全部排序都从这份采集算出来，关掉会让排序退化，所以不提供开关。

| 模块 | 默认 |
|---|---|
| 已开标签管理、暂存区、使用分析 | 核心，不可关闭 |
| 收藏区、重复标签治理、休眠、定时提醒、工作区快照、自动整理、书签与历史检索、回收站与备份 | 开启 |
| LLM 整理助手、标签悬停截图 | 关闭（需自备模型服务地址与密钥 / 按需授予网页权限） |

发现重复标签时只提示，不会替你关掉任何标签：再开一份同样的页面是常见操作（另起一张表单、并排对照），
关不关由你决定。通知与 Dashboard 横幅都给「关闭这个并跳转」和「切换到已有标签」两个按钮，不理它就是两个都留。
批量清理（弹窗与 Dashboard 的「清理重复」）只在主动点击后执行，并附「撤销」。

通知是否留在屏幕上（粘性）是独立设置，默认开启：不常驻时 Windows 可能在你看到之前就收起通知，
「关闭这个并跳转」「续时 10 分钟」两个按钮就来不及点。

`chrome.processes` 只在 Chrome 开发者渠道可用，稳定版上无法工作，因此不提供「渲染进程内存」模块，
manifest 也不申请 `processes` 权限。

## 功能与代码对照

| 模块 | 主要文件 |
|---|---|
| 功能模块开关 | `src/core/modules.js`（注册表）、`src/ui/shared.js` 的 `featureOn()`（各表面统一取用） |
| 存储与迁移 | `src/core/storage.js`、`src/core/defaults.js` |
| 使用分析与闲置度 | `src/core/stats.js`、`src/background/tracker.js` |
| 休眠与保护 | `src/background/sleep.js`、`src/core/actions.js` |
| 重复标签治理 | `src/core/dupes.js`、`src/background/index.js` |
| 自动整理与标签组 | `src/core/organize.js` |
| 统一搜索 | `src/core/search.js`、`src/ui/shared.js`（⌘K 面板） |
| 暂存与收藏区 | `src/core/collections.js` |
| 书签与历史 | `src/core/bookmarks.js`、`src/core/history.js` |
| 定时提醒 | `src/core/reminders.js` |
| 工作区快照 | `src/core/snapshots.js` |
| 回收站与备份 | `src/core/trash.js`、`src/core/backup.js` |
| LLM 助手 | `src/core/llm.js` |
| 悬停截图 | `src/background/screenshots.js`（截与缓存）、`src/ui/shared.js` 的 `installHoverPreview()`（显示） |
| UI 基础件 | `src/ui/kit.js`、`src/ui/icons.js`、`src/ui/styles/*` |

## LLM 助手

兼容 OpenAI `/chat/completions` 协议。先在设置页的「功能模块」里开启 LLM 整理助手，再填写 Base URL、
API Key、模型名；Key 只存在本机 `chrome.storage.local`。请求体只包含标签的标题、域名、闲置分钟数与状态，
不含完整网址与历史。模型返回主题分组与休眠建议后先预览，确认才会应用；不确认则什么都不改。

## 权限说明

| 权限 | 用途 |
|---|---|
| tabs / tabGroups / windows | 标签与分组的读取、移动、休眠、分组 |
| storage / unlimitedStorage | 收藏、快照、统计等本地数据 |
| bookmarks / history / sessions | 书签保存、历史搜索、最近关闭恢复 |
| notifications / alarms | 提醒与自动休眠的触发 |
| favicon | 站点图标 |
| contextMenus | 页面右键的暂存/保护/提醒 |
| activeTab | 用户主动操作时的当前标签访问 |
| optional_host_permissions `<all_urls>` | 仅在开启「标签悬停截图」模块时按需申请 |

## 隐私

没有服务端：不写任何遥测、分析、广告或崩溃上报，也没有作者运营的接口。收藏区、快照、
使用统计、提醒、回收站全部存在本机 `chrome.storage.local`，卸载即随扩展存储一起消失。

对外网络请求只有一处，且默认关闭：LLM 整理助手。开启前需要你自己填 Base URL 与 API Key
（Key 也只存本机），请求体仅含标签标题、域名、闲置分钟数与状态，不含完整网址与历史记录。
「标签悬停截图」的 `<all_urls>` 是按需申请，不授权就不装。

书签与历史只在本机读取用于搜索，读取结果不离开浏览器。

## 开发

无需安装依赖。

```bash
node tools/serve.mjs          # 本地静态服务，默认 8787 端口
node tools/check-imports.mjs  # 校验所有具名导入都有对应导出
node tools/scan-undefined-refs.mjs  # 反向校验：用了却没导入的标识符（如 Button）
node tools/make-icons.mjs     # 重新生成图标（自带像素校验，产出透明图会直接失败）
node tests/run.mjs            # 核心逻辑自动化测试（46 项）
```

`package.json` 只有脚本、没有依赖，可直接 `npm test` 或 `npm run check`（导入校验 + 未导入标识符扫描 + 测试）。
测试跑在 `tests/chrome-stub.mjs` 这个 chrome 测试替身上——它按真实 API 的严格程度实现
（参数校验、`storage.onChanged` 对写入方也触发、`alarms` 名称与查询语义、`tabs.query`
未知过滤器直接报错、通知 `priority` 为负值时按 Windows/Linux/macOS 的真实行为拒绝），
所以通过与否是有意义的。

在浏览器直接打开 `http://localhost:8787/src/dashboard/index.html` 等页面时，
`src/dev/mock-chrome.js` 会注入一套带种子数据的 `chrome.*` 实现（标签、窗口、分组、书签、
历史、最近关闭、存储），因此所有界面都可以在未安装扩展的情况下运行与截图。
页面底部会出现 MOCK 标识条，可一键加标签或重置种子数据。任意页面加 `?theme=dark`
（只在 mock 下生效）即可强制暗色，四个表面都能直接截图对比；加 `?nobanner` 去掉标识条，
用于生成文档截图。

## 视觉令牌

颜色、圆角、间距、阴影与动效时长全部集中在 `src/ui/styles/tokens.css`，亮暗两套只改令牌值。
品牌色是靛蓝→紫渐变：`--primary` 只用于行动与结构（主按钮、开关、复选框、激活标签下划线、
筛选 chip、进度条、当前行指示条），`--gradient-brand` 用于图标与统计卡描边。
站点 favicon 字母块与 Chrome 标签组色属于数据色，`TILE_HUES` 刻意避开 225–285 色相带，
以免站点图标看起来像界面控件。加新界面时取令牌，不要写死颜色或 `ms` 时长。

无头截图示例：

```bash
chrome --headless=new --window-size=1440,900 --virtual-time-budget=4500 \
  --screenshot=out.png "http://localhost:8787/src/dashboard/index.html#tabs"
```

注意：无头模式对 `transform` 居中元素（搜索浮窗等）的渲染不可靠，布局类验证请以有头浏览器为准。

## 许可

源代码以 [MIT](./LICENSE) 授权。界面图标的路径数据衍生自 Lucide（ISC），其中部分图标可继续上溯到
Feather（MIT）；样式基元参考 shadcn/ui（MIT）。三者的完整授权条件与版权声明见
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)，再分发时请一并保留。
