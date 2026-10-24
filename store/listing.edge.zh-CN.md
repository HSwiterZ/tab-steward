# Microsoft Edge 加载项提交资料（中文）

与 Chrome 使用同一份包，注册免费，无需国际信用卡。后台字段按本文顺序填写。

## 0. 注册开发者账号（免费）

1. 打开 [Partner Center · Microsoft Edge](https://partner.microsoft.com/dashboard/microsoftedge/public/login)。
2. 用 Microsoft 账户登录（Outlook / Hotmail / Live 均可；也可以用 GitHub 账号登录，系统会代建一个 MSA）。
3. 填写注册表单：
   - **帐户国家/地区**：填真实所在地。注册后不可修改，不要为了通过审核乱填。
   - **帐户类型**：个人。公司账户需要营业执照、公司审批人，审核要几天到几周，试水没必要。
   - **发布者显示名称**：`HSwiterZ`（最多 50 字符，会公开显示；可用别的名字）。
   - **联系人信息**：能收信的邮箱。
   - 勾选接受开发者协议，点“完成”。
4. 等待验证邮件。个人账号验证较快；期间可以先准备包和素材。

Edge 计划不收取注册费，也没有 $5 一次性费用。

## 1. 包与兼容性

- 上传文件：`dist/tab-steward-1.0.0.zip`
- 版本：`1.0.0`
- 重新打包：`npm run pack`（自动排除 `src/dev`、测试与截图）
- 已实测：Edge `156.0.4314.42` 加载该 zip，Dashboard / 弹窗 / 设置 / 新标签页均正常，Service Worker 无报错；`_favicon` 站点图标与新标签页覆盖均生效。
- manifest 中的 `minimum_chrome_version: 116` 不会阻止 Edge 安装；Chrome 116+ 与 Edge 116+ 共用这一份包。
- 包内没有 `update_url`，符合 Edge 的移植要求。
- 名称与简短说明直接取自 manifest，后台只读。要改这两项必须改 manifest 后重新打包上传。

## 2. 可用性（Availability）

- **可见性**：`Hidden`（隐藏）——只有拿到商品页链接的人能安装，不出现在商店搜索。通过审核后可随时改回 `Public`。
- **市场**：所有市场。
- **价格**：免费。

## 3. 属性（Properties）

| 字段 | 填写 |
| --- | --- |
| 类别 | Productivity（生产力） |
| 网站 | https://hswiterz.github.io/tab-steward/ |
| 支持联系人 | https://github.com/HSwiterZ/tab-steward/issues |
| 成人内容 | 否 |
| 是否访问、收集或传输个人信息 | 是（标签/书签/历史仅本机处理；可选 LLM 助手会外发有限字段） |
| 隐私政策 URL | https://hswiterz.github.io/tab-steward/privacy.html |

隐私政策页已上线（2026-10-24 验证 HTTP 200），中文与英文各一份，无需再等 Pages 构建。

## 4. 隐私页（Privacy）

后台的 Privacy 页分成五块，逐块填。

### 单一用途（Single purpose）

```text
在一个界面里整理、搜索、休眠与暂存浏览器标签页，减少标签页堆积，并能随时恢复最近关闭的页面。
```

### 权限理由（Permission justifications）

| 权限 | 申请理由 |
| --- | --- |
| `tabs` | 列出、切换、移动、休眠与关闭标签；标签管理是本扩展的核心用途。 |
| `tabGroups` | 读取与调整标签组，实现按窗口/站点整理。 |
| `storage` | 在本机保存收藏区、快照、统计、提醒、回收站与设置。 |
| `unlimitedStorage` | 快照与可选截图可能超过 `storage.local` 默认配额；数据仍只在本机。 |
| `bookmarks` | 让统一搜索覆盖书签；只读，不上传。 |
| `history` | 让统一搜索覆盖浏览历史；只读，不上传。 |
| `sessions` | 展示并恢复最近关闭的标签。 |
| `notifications` | 发送定时提醒与重复标签提示。 |
| `alarms` | 定时触发提醒与闲置休眠检查。 |
| `favicon` | 通过浏览器（Chrome / Edge）提供的 `_favicon` 接口显示站点图标。 |
| `contextMenus` | 在页面右键菜单里提供标签操作与提醒入口。 |
| 可选主机权限 `<all_urls>` | 仅在用户开启“标签悬停截图”时申请，用于 `chrome.tabs.captureVisibleTab` 截取当前可见标签；可在设置页撤销。 |

### 远程代码（Remote code）

选择：

```text
否，我没有使用远程代码。
```

所有 JavaScript 都打包在扩展内，没有 `eval`、远程脚本或动态加载。

### 数据使用（Data usage）

按后台勾选项对照：

| 类型 | 是否 | 说明 |
| --- | --- | --- |
| 网页浏览记录（Web history） | 是 | 标签地址/标题、书签与历史只在本机读取；可选 LLM 助手只发送标题、域名、闲置分钟与状态，不含完整网址、书签或历史。 |
| 用户活动（User activity） | 是 | 标签激活次数与前台停留时长在本机统计，用于使用分析。 |
| 身份验证信息（Authentication information） | 是 | 仅限可选的 LLM 助手；API Key 由用户自己填写，只存本机，直连用户填写的服务地址。 |
| 网站内容（Website content） | 是 | 仅限可选的“标签悬停截图”：用户开启后截取当前可见标签的图像，只存本机，不上传。 |
| 个人身份信息、位置、财务、健康、个人通信 | 否 | — |
| 出售或共享数据 | 否 | — |
| 用于信用、借贷或保险评估 | 否 | — |
| 允许人工读取数据 | 否 | 除非安全、法律合规或用户明确请求。 |

加密传输：本地数据不传输；LLM 请求发往用户填写的地址，使用 HTTPS 时加密传输。

### 隐私政策

填入：

```text
https://hswiterz.github.io/tab-steward/privacy.html
```

## 5. Microsoft Store 一览（Listing）

### 语言

包内没有 `_locales`，后台通常只出现 `English (United States)`。按下面处理：

1. 先给 `English (United States)` 填英文说明（`store/listing.en.md` 的 Description 全文，2072 字符），上传徽标与截图。
2. 用“添加语言”加上 `Chinese (Simplified)`，填中文说明（见下），素材可用“复制”从英文行同步。
3. 名称与简短说明来自 manifest，两个语言行都会显示中文的 `Tab Steward` 与中文短说明，这是预期，不需要改包。

### 中文说明（742 字符，满足 250–10,000 字符）

```text
Tab Steward 把打开的标签按站点聚合，让“今天到底开了多少东西”一眼可见。

主要功能：

- 按站点分组：同一域名的标签收在一张卡片里，闲置时长、最近访问、标签数量一起显示。
- 统一搜索（Ctrl/⌘ K）：一次搜标签、暂存区、书签、历史与最近关闭；弹窗、Dashboard、新标签页共用同一套浮窗。
- 休眠与唤醒：按闲置时长自动休眠，或手动休眠单个/整组标签；固定、受保护与正在使用的标签不会被休眠。
- 重复标签只提示：发现重复不替你关闭，通知与横幅都给“关闭这个并跳转”“切换到已有标签”，10 秒后自动消失。
- 收藏区与拖拽：把标签拖进收藏区是暂存，不关标签；支持跨区拖拽与区内排序。
- 快照与撤销：保存当前窗口布局，随时恢复；批量关闭附撤销。
- 使用分析：前台停留时长、激活次数与闲置度统计，全部本地计算。
- 定时提醒：从已打开的标签里选择目标，到点发通知，可续时。
- 新标签页 Dashboard：点新标签页上的 Dashboard 磁贴就地展开完整界面，不开新标签、地址不变。
- 右键菜单：在页面任意位置打开标签操作与提醒。
- 模块开关：不想用的功能可以单独关闭，相关入口与后台任务一起撤掉。

隐私与权限：

- 没有作者运营的服务器，不接入统计、广告或崩溃上报；标签、书签、历史、快照与设置都只在本机。
- 唯一的对外请求是可选的 LLM 整理助手，默认关闭；开启前需自己填写服务地址与 API Key，请求只含标题、域名、闲置分钟与状态。
- “标签悬停截图”需要的 <all_urls> 是按需申请，不授权就不启用，可随时撤销。
- 完整说明见隐私政策。

界面目前为中文；零构建、零依赖，源码以 MIT 许可公开在 GitHub。
```

### English description（2028 字符，已去掉 Markdown 星号）

```text
Tab Steward groups your open tabs by site so you can see at a glance how much is actually open.

What it does:

- Site groups: tabs from the same domain sit in one card with idle time, last visit and tab count.
- One search (Ctrl/⌘ K): tabs, stashed pages, bookmarks, history and recently closed, in the same palette on the popup, Dashboard and new tab page.
- Discard and wake: auto-discard by idle time, or discard a tab or a whole group manually. Pinned, protected and active tabs are never touched.
- Duplicates only prompt: nothing is closed for you. The notification and banner offer “Close this and jump” and “Switch to the existing tab”, and the prompt clears itself after 10 seconds.
- Collections and drag-and-drop: dragging a tab into a collection stashes it without closing it; reorder inside a collection or across collections.
- Snapshots and undo: save a window layout and restore it later; bulk closes come with Undo.
- Usage analytics: foreground time, activation count and idle score, computed locally.
- Reminders: pick a target from your open tabs, get a notification on time, snooze when needed.
- Inline Dashboard on the new tab page: the Dashboard tile expands in place — no navigation, no new tab, the address stays the same.
- Context menu: tab actions and reminder entry from any page.
- Module switches: turn off what you do not use; its entry points and background work go away with it.

Privacy:

- No developer-operated server, no analytics, ads or crash reporting. Tabs, bookmarks, history, snapshots and settings stay on your machine.
- The only outbound request is the optional LLM organizer, off by default. It sends tab titles, domains, idle minutes and state to the endpoint you enter; no full URLs, bookmarks or history.
- The <all_urls> permission for hover screenshots is requested on demand, never granted implicitly, and can be revoked in settings.
- Full text in the privacy policy.

The interface is currently Chinese. Zero build, zero dependencies; source is MIT licensed on GitHub.
```

### 图片素材

| 字段 | 文件 | 规格 |
| --- | --- | --- |
| 扩展徽标 | `store/logo-300x300.png` | 300×300，1:1（后台建议 300，最小 128） |
| 小型促销磁贴 | `store/promo-440x280.png` | 440×280 |
| 大型促销磁贴 | `store/promo-1400x560.png` | 1400×560 |
| 截图 1 | `store/screenshots/01-overview.png` | 1280×800，Dashboard 总览 |
| 截图 2 | `store/screenshots/02-dark.png` | 1280×800，深色主题 |
| 截图 3 | `store/screenshots/03-analytics.png` | 1280×800，使用分析 |
| 截图 4 | `store/screenshots/04-search.png` | 1280×800，统一搜索 |
| 截图 5 | `store/screenshots/05-popup.png` | 1280×800，工具栏弹窗 |
| 截图 6 | `store/screenshots/06-context-menu.png` | 1280×800，页面右键菜单 |

Edge 只接受 640×480 或 1280×800 的截图，最多 6 张；现有 6 张全部为 1280×800。第 6 张是 Edge 专用，Chrome Web Store 最多 5 张，不要加进去。大型磁贴可选，但传了会获得更显眼的展示位。

### 搜索词（7 个，每个 ≤30 字符）

```text
标签管理
标签页整理
标签搜索
会话管理
新标签页
tab manager
productivity
```

## 6. 认证说明（Notes for certification）

```text
无需账号或登录即可测试全部功能。点击工具栏图标打开弹窗；Alt+Shift+T 打开 Dashboard。

新标签页会被替换为极简起始页，这是产品功能之一；点页面上的 Dashboard 磁贴会在原地展开完整界面，不跳转、不开新标签。

可选的 LLM 整理助手默认关闭，不配置也能审查所有本地功能；“标签悬停截图”默认不授权，需要时在设置页点“授予主机权限”后才生效，并可撤销。

界面目前为中文。数据全部保存在本机。
```

## 7. 提交前检查

1. 开发者账号验证通过（免费，个人账号）。
2. 上传 `dist/tab-steward-1.0.0.zip`，确认版本显示 `1.0.0`。
3. 可见性 `Hidden`，所有市场，免费。
4. 隐私政策 URL 可打开：https://hswiterz.github.io/tab-steward/privacy.html
5. 徽标、两张促销图与 6 张截图按上表上传，尺寸不要二次压缩。
6. 提交认证；Edge 官方说明最长约 7 个工作日。
7. 通过后复制商品页链接；需要公开搜索时把可见性改成 `Public`。

## 8. 上架后的一个注意点

商店版扩展 ID 与本地加载的未打包版不同。切换前先在旧版设置页导出 JSON，装商店版后再导入，收藏区、快照、统计与提醒不会丢。
