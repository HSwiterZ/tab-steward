import { store } from "./storage.js";
import { isOn } from "./modules.js";
import { siteOf, urlKey, hostname } from "./utils.js";
import { enrichTab } from "./stats.js";
import { GROUP_COLORS, createGroup, canSleep } from "./actions.js";

const SYSTEM_PROMPT = `你是浏览器标签整理助手。用户会提供当前窗口的标签清单，每条只包含：序号、标题、域名、闲置分钟数、状态（active/pinned/audible/discarded/normal）。

请根据用户给出的整理目标，把这些标签划分成主题分组，并挑出应当休眠的标签。

严格输出 JSON，不要输出任何解释性文字或 Markdown 代码块，结构如下：
{
  "groups": [
    { "name": "分组名（2-6 个汉字）", "color": "grey|blue|red|yellow|green|pink|purple|cyan|orange", "indexes": [0, 3, 7], "reason": "一句话说明" }
  ],
  "sleep": { "indexes": [1, 4], "reason": "一句话说明" },
  "summary": "一句话总结这次整理"
}

规则：
- indexes 必须是输入里出现过的序号，不得编造。
- 一个序号最多出现在一个分组里。
- active 与 pinned 的标签不要放进 sleep。
- 分组数量控制在 2 到 6 个，宁少勿多；无法归类的标签不要强行塞进分组。
- color 必须取自给定枚举。`;

export function isConfigured(settings = store.get("settings") || {}) {
  const llm = settings.llm || {};
  return !!(llm.baseUrl && llm.model && String(llm.baseUrl).trim() && String(llm.model).trim());
}

export function configIssues(settings = store.get("settings") || {}) {
  const llm = settings.llm || {};
  const issues = [];
  if (!String(llm.baseUrl || "").trim()) issues.push("未填写服务地址 Base URL");
  else if (!/^https?:\/\//i.test(String(llm.baseUrl).trim())) issues.push("Base URL 需要以 http:// 或 https:// 开头");
  if (!String(llm.model || "").trim()) issues.push("未填写模型名");
  if (!isOn(settings, "llm")) issues.push("「LLM 整理助手」模块未启用");
  return issues;
}

/**
 * The privacy boundary: only index, title, domain, idle minutes and state ever
 * leave the machine. URLs, history and stats stay local.
 */
export function buildTabContext(tabs, { now = Date.now() } = {}) {
  const stats = store.get("stats") || {};
  const sites = store.get("sites") || {};
  return tabs.map((tab, index) => {
    const e = enrichTab(tab, { stats, sites, now });
    const state = tab.active
      ? "active"
      : tab.pinned
        ? "pinned"
        : tab.audible
          ? "audible"
          : tab.discarded
            ? "discarded"
            : "normal";
    return {
      index,
      id: tab.id,
      windowId: tab.windowId,
      title: (tab.title || "").slice(0, 120),
      domain: siteOf(tab.url) || hostname(tab.url) || "",
      idleMinutes: Math.round(e.idleMs / 60000),
      state,
      groupTitle: tab.groupId > -1 ? undefined : null,
      urlKey: urlKey(tab.url),
    };
  });
}

export function buildUserPrompt(context, goal) {
  const lines = context.map((c) => `${c.index}. ${c.title} | ${c.domain} | 闲置 ${c.idleMinutes} 分钟 | ${c.state}`);
  return `整理目标：${goal || "按主题归类，并休眠长时间不用的标签"}\n\n当前窗口标签（共 ${context.length} 条）：\n${lines.join("\n")}`;
}

function endpointFor(baseUrl) {
  const trimmed = String(baseUrl).trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(trimmed)) return trimmed;
  if (/\/v\d+$/.test(trimmed)) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

/**
 * Call an OpenAI-compatible /chat/completions endpoint.
 * Nothing is hardcoded: base URL, key and model all come from the options page.
 */
export async function requestSuggestions({ tabs, goal, signal } = {}) {
  const settings = store.get("settings") || {};
  const llm = settings.llm || {};
  const issues = configIssues(settings);
  if (issues.length) return { ok: false, error: issues.join("；"), issues };

  const context = buildTabContext(tabs);
  if (!context.length) return { ok: false, error: "当前窗口没有可整理的标签" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(5000, llm.timeoutMs || 30000));
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener?.("abort", onOuterAbort);

  const started = Date.now();
  let response;
  try {
    response = await fetch(endpointFor(llm.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(llm.apiKey ? { Authorization: `Bearer ${llm.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: llm.model,
        temperature: llm.temperature ?? 0.3,
        stream: false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(context, goal) },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", onOuterAbort);
    const aborted = err?.name === "AbortError";
    return {
      ok: false,
      error: aborted ? "请求超时或已取消" : `无法连接模型服务：${err?.message || err}`,
      hint: aborted ? undefined : "请检查 Base URL 是否正确、服务是否在运行，以及浏览器是否有访问该地址的权限。",
    };
  }
  clearTimeout(timeout);
  signal?.removeEventListener?.("abort", onOuterAbort);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      ok: false,
      error: `模型服务返回 ${response.status} ${response.statusText || ""}`.trim(),
      detail: body.slice(0, 400),
      hint: response.status === 401 ? "API Key 可能无效或未填写。" : response.status === 404 ? "接口路径可能不对，试试把 Base URL 填到 /v1 一级。" : undefined,
    };
  }

  const data = await response.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) return { ok: false, error: "模型没有返回内容", detail: JSON.stringify(data).slice(0, 400) };

  const parsed = parseModelJson(content);
  if (!parsed.ok) return { ok: false, error: parsed.error, raw: content.slice(0, 600) };

  const plan = normalisePlan(parsed.value, context);
  await store.patch("settings", { llm: { lastRunAt: Date.now() } });
  return {
    ok: true,
    plan,
    context,
    elapsedMs: Date.now() - started,
    usage: data.usage || null,
    model: llm.model,
    summary: parsed.value.summary || "",
    raw: content,
  };
}

/** Models love wrapping JSON in ```json fences despite being told not to. */
export function parseModelJson(content) {
  const text = String(content).trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return { ok: false, error: "返回内容里没有 JSON 对象" };
  try {
    return { ok: true, value: JSON.parse(candidate.slice(start, end + 1)) };
  } catch (err) {
    return { ok: false, error: `JSON 解析失败：${err.message}` };
  }
}

/** Clamp the model's output to what we can actually apply. */
export function normalisePlan(value, context) {
  const validIndexes = new Set(context.map((c) => c.index));
  const byIndex = new Map(context.map((c) => [c.index, c]));
  const claimed = new Set();
  const groups = [];

  for (const raw of Array.isArray(value.groups) ? value.groups : []) {
    const name = String(raw?.name || "").trim().slice(0, 24);
    if (!name) continue;
    const indexes = (Array.isArray(raw?.indexes) ? raw.indexes : [])
      .map((n) => Number(n))
      .filter((n) => validIndexes.has(n) && !claimed.has(n) && byIndex.get(n).state !== "discarded");
    for (const i of indexes) claimed.add(i);
    if (!indexes.length) continue;
    const color = GROUP_COLORS.includes(raw?.color) ? raw.color : colorForName(name);
    groups.push({ name, color, indexes, reason: String(raw?.reason || ""), tabs: indexes.map((i) => byIndex.get(i)) });
  }

  const sleepIndexes = (Array.isArray(value.sleep?.indexes) ? value.sleep.indexes : [])
    .map((n) => Number(n))
    .filter((n) => validIndexes.has(n) && !claimed.has(n))
    .filter((n) => byIndex.get(n).state !== "active" && byIndex.get(n).state !== "pinned");

  return {
    groups: groups.slice(0, 8),
    sleep: { indexes: sleepIndexes, reason: String(value.sleep?.reason || ""), tabs: sleepIndexes.map((i) => byIndex.get(i)) },
    summary: String(value.summary || ""),
    unassigned: context.filter((c) => !claimed.has(c.index) && !sleepIndexes.includes(c.index)).map((c) => c.index),
  };
}

function colorForName(name) {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum = (sum * 31 + name.charCodeAt(i)) >>> 0;
  return GROUP_COLORS[sum % GROUP_COLORS.length];
}

/**
 * Apply a confirmed plan. Returns per-step results so the UI can show exactly
 * what happened, including tabs Chrome refused to discard.
 */
export async function applyPlan(plan) {
  const result = { groups: 0, slept: 0, skipped: 0, errors: [] };
  for (const group of plan.groups || []) {
    const ids = group.tabs.map((t) => t.id);
    if (!ids.length) continue;
    try {
      await createGroup(ids, { title: group.name, color: group.color });
      result.groups++;
    } catch (err) {
      result.errors.push(`分组「${group.name}」失败：${err?.message || err}`);
    }
  }
  for (const tab of plan.sleep?.tabs || []) {
    try {
      const fresh = await chrome.tabs.get(tab.id);
      if (!canSleep(fresh)) {
        result.skipped++;
        continue;
      }
      await chrome.tabs.discard(tab.id);
      result.slept++;
    } catch (err) {
      result.errors.push(`休眠失败：${err?.message || err}`);
    }
  }
  return result;
}

export const LLM_COLORS = GROUP_COLORS;
export { urlKey };
