/**
 * Records the README demo GIFs by driving the mock UI over CDP and stitching the
 * captured frames with ffmpeg.
 *
 *   node tools/serve.mjs 8799          # in another shell
 *   node tools/record-demo.mjs         # every demo
 *   node tools/record-demo.mjs search  # only demos whose name contains this
 *
 * Needs Chrome and ffmpeg on PATH (override with CHROME=...). Output goes to
 * docs/demos/<name>.gif.
 *
 * Each step fires its action without waiting for it, then samples the screen
 * every FRAME_MS for `hold` milliseconds — so typing, moving highlights and
 * scrolling are captured as motion instead of one jump cut per action.
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
const FRAME_MS = Number(process.env.DEMO_FRAME_MS || 110);
const COLORS = Number(process.env.DEMO_COLORS || 96);
const PAD = 10;

// Fractions of the viewport, because the window Chrome actually gets is capped
// by the screen: asking for 1440x900 can yield 764x485.
const MAIN = { x: 0.014, y: 0.14, w: 0.63, h: 0.56 };
const FULL = { x: 0, y: 0, w: 1, h: 0.66 };
const WHOLE = { x: 0, y: 0, w: 1, h: 1 };
const WAIT = `(ms) => new Promise((r) => setTimeout(r, ms))`;

const demos = [
  {
    name: "search",
    // The palette is centred with a transform, and headless Chrome paints
    // transform-centred elements unreliably — clipping to its measured rect cut
    // the palette out entirely. Take the whole top band instead.
    clip: FULL,
    steps: [
      { hold: 700, shot: "顶栏" },
      { do: `window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })), "opened"`, hold: 900, shot: "⌘K 打开统一搜索" },
      { do: `(async () => { const i = document.querySelector(".palette-input"); for (const ch of "chrome") { i.value += ch; i.dispatchEvent(new Event("input", { bubbles: true })); await (${WAIT})(240); } return i.value; })()`, hold: 2200, shot: "逐字输入，结果实时收敛" },
      { do: `(async () => { for (let k = 0; k < 3; k++) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); await (${WAIT})(320); } return "3 项"; })()`, hold: 1400, shot: "方向键在分组结果间移动" },
      { do: `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })), "picked"`, hold: 1500, shot: "回车跳到那个标签" },
    ],
  },
  {
    name: "stash-drag",
    // Measured per frame; the union below covers the panel collapsed and expanded.
    clipSel: ".side-panel",
    clip: FULL,
    steps: [
      { do: `[...document.querySelectorAll(".side-col-item")].map(n => n.dataset.id + "=" + n.querySelector(".badge").textContent).join(" ")`, hold: 800, shot: "收藏区默认折叠" },
      { do: `(() => { const dt = new DataTransfer(); window.__dt = dt; document.querySelector(".tab-row").dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt })); const head = document.querySelector('.side-col-item[data-id="stash"] .side-col-head'); head.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt })); return "highlight=" + document.querySelector('.side-col-item[data-id="stash"]').dataset.dropActive; })()`, hold: 1100, shot: "标签拖到暂存区上" },
      { do: `document.querySelector('.side-col-item[data-id="col-papers"] .side-col-head').dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: window.__dt })), "moved"`, hold: 1100, shot: "换到论文阅读，高亮跟着走" },
      { do: `document.querySelector('.side-col-item[data-id="col-papers"] .side-col-head').dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: window.__dt })), "dropped"`, hold: 1800, shot: "松手即暂存，标签不关" },
      { do: `document.querySelector('.side-col-item[data-id="col-papers"] .side-col-head').click(), "expanded"`, hold: 1400, shot: "展开后条目就在里面" },
    ],
  },
  {
    name: "sleep",
    // The row that changes sits below the toolbar, so keep the whole frame.
    clip: WHOLE,
    steps: [
      { do: `document.querySelectorAll(".site-card").length + " 张卡片 / " + document.querySelectorAll(".tab-row").length + " 行"`, hold: 900, shot: "站点卡片按闲置度排序" },
      { do: `(() => { const b = [...document.querySelectorAll('.tab-row button[title="休眠"]')].find(n => !n.disabled); if (!b) throw new Error("no enabled sleep button"); b.click(); return "clicked"; })()`, hold: 2600, shot: "点一下，这行进入休眠" },
    ],
  },
  {
    name: "duplicates",
    clip: WHOLE,
    steps: [
      { do: `document.querySelectorAll(".tab-row").length + " 行"`, hold: 900, shot: "全部标签" },
      { do: `(() => { const b = [...document.querySelectorAll("button")].find(n => /^重复/.test(n.textContent.trim())); if (!b) throw new Error("no duplicate chip"); b.click(); return "filtered"; })()`, hold: 2200, shot: "只看重复标签" },
    ],
  },
  {
    name: "organize",
    clip: MAIN,
    steps: [
      { do: `(() => { const b = [...document.querySelectorAll("button")].find(n => (n.getAttribute("title") || "") === "自动整理"); if (!b) throw new Error("no organize button"); b.click(); return "menu"; })()`, hold: 1200, shot: "自动整理菜单" },
      { do: `(() => { const b = [...document.querySelectorAll(".menu-item")].find(n => /当前窗口：同站点相邻/.test(n.textContent)); if (!b) throw new Error("no arrange item"); b.click(); return "arranged"; })()`, hold: 2600, shot: "同站点排到相邻位置" },
    ],
  },
  {
    name: "snapshots",
    page: "src/dashboard/index.html#snapshots",
    clip: MAIN,
    steps: [
      { hold: 900, shot: "工作区快照列表" },
      { do: `(() => { const b = [...document.querySelectorAll("button")].find(n => /保存当前窗口/.test(n.textContent)); if (!b) throw new Error("no save button"); b.click(); return "saved"; })()`, hold: 2600, shot: "保存当前窗口为新快照" },
    ],
  },
  {
    name: "reminders",
    page: "src/dashboard/index.html#reminders",
    clip: MAIN,
    steps: [
      { hold: 900, shot: "提醒列表与到期项" },
      { do: `(() => { const b = [...document.querySelectorAll("button")].find(n => /创建提醒/.test(n.textContent)); if (!b) throw new Error("no create-reminder button"); b.click(); return "form"; })()`, hold: 1500, shot: "创建提醒：目标从已打开标签里选" },
      { do: `(() => { const b = [...document.querySelectorAll("button")].find(n => /30 分钟/.test(n.textContent)); if (!b) throw new Error("no duration chip"); b.click(); return "30 分钟"; })()`, hold: 1500, shot: "选时长" },
    ],
  },
  {
    name: "analytics",
    page: "src/dashboard/index.html#analytics",
    clip: MAIN,
    steps: [
      { hold: 900, shot: "总览与站点时长排行" },
      { do: `(async () => { const el = document.scrollingElement; for (let y = 0; y <= 480; y += 40) { el.scrollTop = y; await (${WAIT})(70); } return "scrolled"; })()`, hold: 1600, shot: "逐页使用时长明细" },
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
      "--force-device-scale-factor=1",
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
    if (res?.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description?.split("\n")[0] || "eval threw");
    return res?.result?.value;
  };
  return { ws, send, evaluate };
}

async function measureRect(evaluate, demo) {
  const [vpW, vpH] = await evaluate(`[innerWidth, innerHeight]`);
  if (demo.clipSel) {
    const sel = JSON.stringify(demo.clipSel);
    const found = await evaluate(`(() => { const n = document.querySelector(${sel}); if (!n) return null; const b = n.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; })()`);
    if (found) return { x: Math.max(0, found[0] - PAD), y: Math.max(0, found[1] - PAD), width: found[2] + PAD * 2, height: found[3] + PAD * 2, vpW, vpH };
  }
  const f = demo.clip;
  return { x: f.x * vpW, y: f.y * vpH, width: f.w * vpW, height: f.h * vpH, vpW, vpH };
}

function unionRect(a, b) {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y, vpW: b.vpW, vpH: b.vpH };
}

function clampRect(r) {
  const x = Math.max(0, Math.round(r.x));
  const y = Math.max(0, Math.round(r.y));
  return { x, y, width: Math.max(60, Math.round(Math.min(r.vpW - x, r.width))), height: Math.max(60, Math.round(Math.min(r.vpH - y, r.height))) };
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
    let frame = 0;
    // Query before hash, or #view?x=y swallows the params.
    const [path, hash] = (demo.page || "src/dashboard/index.html").split("#");
    const url = `${BASE}/${path}?nobanner&demo=${demo.name}#${hash || ""}`;
    await send("Page.navigate", { url });
    await sleep(1500);
    // Sort, filter chips and expanded sites are persisted, so without this each
    // demo would start from the previous one's leftovers.
    await evaluate(`localStorage.clear(), "cleared"`);
    await send("Page.reload", { ignoreCache: true });
    await sleep(1800);
    // Frames are always the full viewport so the sequence has one constant size
    // (mixed sizes break paletteuse, or silently scramble the GIF). The crop is
    // applied in ffmpeg, as the union of every rect seen while recording.
    let seen = null;
    const grab = async () => {
      seen = unionRect(seen, await measureRect(evaluate, demo));
      const shot = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(join(dir, `frame_${String(++frame).padStart(3, "0")}.png`), Buffer.from(shot.data, "base64"));
    };

    for (const [i, step] of demo.steps.entries()) {
      let value;
      let failure;
      // Fire the action and keep sampling while it plays out.
      const running = step.do
        ? evaluate(`(() => { return (${step.do}); })()`).then(
            (v) => (value = v),
            (err) => (failure = err.message)
          )
        : Promise.resolve();
      const started = Date.now();
      do {
        await grab();
        await sleep(Math.max(10, FRAME_MS - ((Date.now() - started) % FRAME_MS)));
      } while (Date.now() - started < (step.hold ?? 700));
      await running;
      if (failure) errors.push(`step ${i + 1} (${step.shot}): ${failure}`);
      console.log(`  ${demo.name} #${i + 1} ${step.shot} -> ${failure ? "ERROR " + failure : value ?? "ok"} (${frame} frames)`);
    }

    const gif = join(OUT_DIR, `${demo.name}.gif`);
    const clip = clampRect(seen || (await measureRect(evaluate, demo)));
    const crop = `crop=${clip.width}:${clip.height}:${clip.x}:${clip.y}:exact=0`;
    const vf = `${crop},split[s][o];[o]palettegen=max_colors=` + COLORS + ":stats_mode=diff[p];[s][p]paletteuse=dither=bayer:bayer_scale=5";
    const enc = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(Math.round(1000 / FRAME_MS)), "-i", join(dir, "frame_%03d.png"), "-vf", vf, gif]);
    if (enc.status !== 0) errors.push(`ffmpeg: ${enc.stderr?.toString().slice(0, 200)}`);
    report.push({ demo: demo.name, frames: frame, errors });
    console.log(`${errors.length ? "WARN" : "ok  "} ${demo.name}.gif — ${frame} frames`);
  }

  ws.close();
  chrome.kill();
  await sleep(1200);
  // DEMO_KEEP=1 leaves the raw frames on disk so a suspicious clip can be
  // inspected frame by frame instead of through the encoded GIF.
  if (!process.env.DEMO_KEEP) await rm(WORK, { recursive: true, force: true }).catch(() => {});
  const bad = report.filter((r) => r.errors.length);
  console.log(`\n${report.length} demo(s), ${bad.length} with issues`);
  for (const b of bad) for (const e of b.errors) console.log(`  ${b.demo}: ${e}`);
  process.exit(bad.length ? 1 : 0);
}

run();
