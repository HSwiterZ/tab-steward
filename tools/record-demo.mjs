/**
 * Records the README demo GIFs by driving the mock UI over CDP and stitching
 * the captured keyframes with ffmpeg.
 *
 *   node tools/serve.mjs 8799          # in another shell
 *   node tools/record-demo.mjs         # every demo
 *   node tools/record-demo.mjs search  # only demos whose name contains this
 *
 * Needs Chrome and ffmpeg on PATH (override with CHROME=...). Output goes to
 * docs/demos/<name>.gif. Frames are clipped per step from the element named by
 * clipSel, so a panel that grows or scrolls still stays in shot.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const BASE = process.env.DEMO_BASE || "http://localhost:8799";
const PORT = Number(process.env.DEMO_CDP_PORT || 9333);
const CHROME = process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT_DIR = join(ROOT, "docs", "demos");
// Frames and the throwaway profile stay out of the repo — Windows keeps profile
// files locked briefly after Chrome exits, and rm() inside the tree is a way to
// lose real files.
const WORK = join(tmpdir(), "tab-steward-demos");
const FPS = Number(process.env.DEMO_FPS || 1.2);
const PAD = 10;

// A headless window is not the viewport: 1440x900 renders 1424x805.
const MAIN = { x: 20, y: 116, width: 900, height: 440 };

const demos = [
  {
    name: "search",
    clipSel: ".palette",
    clip: { x: 330, y: 8, width: 800, height: 440 },
    steps: [
      { shot: "顶栏" },
      { do: `window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })), "opened"`, wait: 400, shot: "⌘K 打开统一搜索" },
      { do: `(() => { const i = document.querySelector(".palette-input"); i.value = "chrome"; i.dispatchEvent(new Event("input", { bubbles: true })); return i.value; })()`, wait: 800, shot: "输入关键词" },
      { do: `document.querySelectorAll(".palette-item").length + " 条结果"`, shot: "按来源分组的结果" },
    ],
  },
  {
    name: "stash-drag",
    clipSel: ".side-panel",
    clip: { x: 1060, y: 100, width: 356, height: 300 },
    steps: [
      { do: `[...document.querySelectorAll(".side-col-item")].map(n => n.dataset.id + "=" + n.querySelector(".badge").textContent).join(" ")`, shot: "收藏区默认折叠" },
      { do: `(() => { const dt = new DataTransfer(); window.__dt = dt; document.querySelector(".tab-row").dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt })); const head = document.querySelector('.side-col-item[data-id="stash"] .side-col-head'); head.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt })); return "highlight=" + document.querySelector('.side-col-item[data-id="stash"]').dataset.dropActive; })()`, shot: "标签拖到折叠的收藏区上，虚线高亮" },
      { do: `document.querySelector('.side-col-item[data-id="stash"] .side-col-head').dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: window.__dt })), "dropped"`, wait: 800, shot: "松手即暂存，标签不关" },
      { do: `(() => { const n = document.querySelector('.side-col-item[data-id="stash"]'); if (!n.querySelector(".collection-body")) n.querySelector(".side-col-head").click(); return "expanded"; })()`, wait: 500, shot: "展开后条目在列表里" },
    ],
  },
  {
    name: "sleep",
    clip: MAIN,
    steps: [
      { do: `document.querySelectorAll(".site-card").length + " 张卡片 / " + document.querySelectorAll(".tab-row").length + " 行"`, shot: "站点卡片按闲置度排序" },
      { do: `(() => { const b = [...document.querySelectorAll('.tab-row button[title="休眠"]')].find(n => !n.disabled); if (!b) throw new Error("no enabled sleep button"); b.scrollIntoView({ block: "center" }); b.click(); return "slept"; })()`, wait: 900, shot: "点一行的休眠" },
      { do: `(() => { const r = [...document.querySelectorAll(".tab-row")].find(n => n.textContent.includes("已休眠")); if (r) r.scrollIntoView({ block: "center" }); return r ? "已休眠 row in frame" : "no slept row"; })()`, wait: 4000, shot: "该行变为已休眠" },
    ],
  },
  {
    name: "duplicates",
    clip: MAIN,
    steps: [
      { do: `document.querySelectorAll(".tab-row").length + " 行"`, shot: "全部标签" },
      { do: `(() => { const b = [...document.querySelectorAll("button")].find(n => /^重复/.test(n.textContent.trim())); if (!b) throw new Error("no duplicate chip"); b.click(); return "filtered"; })()`, wait: 800, shot: "只看重复标签" },
    ],
  },
  {
    name: "organize",
    clip: MAIN,
    steps: [
      { do: `(() => { const b = [...document.querySelectorAll("button")].find(n => (n.getAttribute("title") || "") === "自动整理"); if (!b) throw new Error("no organize button"); b.click(); return "menu opened"; })()`, wait: 400, shot: "自动整理菜单" },
      { do: `(() => { const b = [...document.querySelectorAll(".menu-item")].find(n => /当前窗口：同站点相邻/.test(n.textContent)); if (!b) throw new Error("no arrange item"); b.click(); return "arranged"; })()`, wait: 900, shot: "同站点相邻后的卡片顺序" },
    ],
  },
  {
    name: "snapshots",
    page: "src/dashboard/index.html#snapshots",
    clip: MAIN,
    steps: [
      { do: `document.querySelectorAll("button").length + " buttons"`, shot: "工作区快照列表" },
      { do: `(() => { const b = [...document.querySelectorAll("button")].find(n => /保存当前窗口/.test(n.textContent)); if (!b) throw new Error("no save button"); b.click(); return "saved"; })()`, wait: 900, shot: "保存当前窗口为新快照" },
    ],
  },
  {
    name: "reminders",
    page: "src/dashboard/index.html#reminders",
    clip: MAIN,
    steps: [
      { do: `document.querySelectorAll("button").length + " buttons"`, shot: "提醒列表与到期项" },
      { do: `(() => { const b = [...document.querySelectorAll("button")].find(n => /创建提醒/.test(n.textContent)); if (!b) throw new Error("no create-reminder button"); b.click(); return "form opened"; })()`, wait: 700, shot: "创建提醒：从已打开标签里选目标 + 定时长" },
    ],
  },
  {
    name: "analytics",
    page: "src/dashboard/index.html#analytics",
    clip: MAIN,
    steps: [
      { do: `document.querySelectorAll(".stat-card,.card").length + " cards"`, shot: "总览与站点时长排行" },
      { do: `(() => { const n = document.querySelector(".view") || document.scrollingElement; n.scrollTop = 460; return "scrolled"; })()`, wait: 400, shot: "逐页使用时长明细" },
    ],
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForUrl(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  return false;
}

function launchChrome() {
  const child = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      `--remote-debugging-port=${PORT}`,
      "--window-size=1440,900",
      `--user-data-dir=${join(WORK, "profile")}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  child.on("error", (err) => {
    console.error(`failed to start chrome: ${err.message}`);
    process.exit(1);
  });
  return child;
}

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page") || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("cdp websocket failed"));
  });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (res?.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || "eval threw");
    return res?.result?.value;
  };
  return { ws, send, evaluate };
}

async function clipFor(evaluate, demo) {
  const [vpW, vpH] = await evaluate(`[innerWidth, innerHeight]`);
  let rect = demo.clip;
  if (demo.clipSel) {
    const found = await evaluate(
      `(() => { const n = document.querySelector(${JSON.stringify(demo.clipSel)}); if (!n) return null; const b = n.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; })()`
    );
    if (found) rect = { x: found[0], y: found[1], width: found[2], height: found[3] };
  }
  const x = Math.max(0, rect.x - PAD);
  const y = Math.max(0, rect.y - PAD);
  const width = Math.min(vpW - x, rect.width + PAD * 2);
  const height = Math.min(vpH - y, rect.height + PAD * 2);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(Math.max(60, width)), height: Math.round(Math.max(60, height)) };
}

async function run() {
  const filter = process.argv[2];
  const chosen = filter ? demos.filter((d) => d.name.includes(filter)) : demos;
  if (!chosen.length) {
    console.error(`no demo matches "${filter}" — known: ${demos.map((d) => d.name).join(", ")}`);
    process.exit(1);
  }
  if (!existsSync(CHROME)) {
    console.error(`chrome not found at ${CHROME} (set CHROME=...)`);
    process.exit(1);
  }
  if (!(await waitForUrl(`${BASE}/src/dashboard/index.html`))) {
    console.error(`dev server not reachable at ${BASE} — start it: node tools/serve.mjs`);
    process.exit(1);
  }

  await rm(WORK, { recursive: true, force: true }).catch(() => {});
  await mkdir(OUT_DIR, { recursive: true });
  const chrome = launchChrome();
  await waitForUrl(`http://127.0.0.1:${PORT}/json/version`);
  const { ws, send, evaluate } = await connect();
  await send("Page.enable");

  const report = [];
  for (const demo of chosen) {
    const dir = join(WORK, demo.name);
    await mkdir(dir, { recursive: true });
    const errors = [];
    // Query before hash, or #view?x=y swallows the params.
    const [path, hash] = (demo.page || "src/dashboard/index.html").split("#");
    const url = `${BASE}/${path}?nobanner&demo=${demo.name}#${hash || ""}`;
    await send("Page.navigate", { url });
    await sleep(1500);
    // View state (sort, filter chips, expanded sites) is persisted, so without
    // this every demo would start from the previous one's leftovers.
    await evaluate(`localStorage.clear(), "cleared"`);
    await send("Page.reload", { ignoreCache: true });
    await sleep(1800);

    for (let i = 0; i < demo.steps.length; i++) {
      const step = demo.steps[i];
      if (step.do) {
        try {
          const value = await evaluate(`(() => { return (${step.do}); })()`);
          console.log(`  ${demo.name} #${i + 1} ${step.shot} -> ${value}`);
        } catch (err) {
          errors.push(`step ${i + 1} (${step.shot}): ${err.message}`);
          console.log(`  ${demo.name} #${i + 1} ${step.shot} -> ERROR ${err.message}`);
        }
      }
      if (step.wait) await sleep(step.wait);
      const shot = await send("Page.captureScreenshot", {
        format: "png",
        clip: { ...(await clipFor(evaluate, demo)), scale: 1 },
        captureBeyondViewport: true,
      });
      await writeFile(join(dir, `frame_${String(i + 1).padStart(3, "0")}.png`), Buffer.from(shot.data, "base64"));
    }

    const gif = join(OUT_DIR, `${demo.name}.gif`);
    const vf = "split[s][o];[o]palettegen=max_colors=128:stats_mode=diff[p];[s][p]paletteuse=dither=bayer:bayer_scale=5";
    const enc = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "frame_%03d.png"), "-vf", vf, gif]);
    if (enc.status !== 0) errors.push(`ffmpeg: ${enc.stderr?.toString().slice(0, 200)}`);
    report.push({ demo: demo.name, errors });
    console.log(`${errors.length ? "WARN" : "ok  "} ${demo.name}.gif`);
  }

  ws.close();
  chrome.kill();
  await sleep(1200);
  await rm(WORK, { recursive: true, force: true }).catch(() => {});
  const bad = report.filter((r) => r.errors.length);
  console.log(`\n${report.length} demo(s), ${bad.length} with issues`);
  for (const b of bad) for (const e of b.errors) console.log(`  ${b.demo}: ${e}`);
  process.exit(bad.length ? 1 : 0);
}

run();
