/**
 * Generates assets/icon{16,32,48,128}.png with no dependencies.
 *
 * Each size is drawn at an integer supersample factor (SS) and box-downsampled,
 * so every output pixel is an exact average of SS*SS samples. The previous
 * version used one fixed 512px canvas for all sizes, which made 512/48
 * non-integer, read past the end of the buffer while downsampling, and wrote a
 * silently transparent icon48.png. verify() now fails the build if that happens
 * again.
 */
import { deflateSync, inflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets");
mkdirSync(OUT, { recursive: true });

const SIZES = [16, 32, 48, 128];
const SS = 8; // supersample factor per axis

/* --------------------- brand ramp: keep in sync with tokens.css --------------------- */
const BRAND_FROM = [239, 84, 67]; // --brand-from (H S L, percent)
const BRAND_TO = [268, 72, 60]; // --brand-to

function hslToRgb(h, s, l) {
  const S = s / 100;
  const L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = L - c / 2;
  const seg =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return seg.map((v) => Math.round((v + m) * 255));
}

const FROM = hslToRgb(...BRAND_FROM);
const TO = hslToRgb(...BRAND_TO);
const WHITE = [255, 255, 255];

/* ------------------------- png encoder ------------------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function decodePng(buf) {
  let off = 8;
  const idat = [];
  let width = 0;
  let height = 0;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    if (type === "IHDR") {
      width = buf.readUInt32BE(off + 8);
      height = buf.readUInt32BE(off + 12);
    }
    if (type === "IDAT") idat.push(buf.slice(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw.copy(out, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  }
  return { width, height, rgba: out };
}

/* ------------------------- geometry ------------------------- */
// All coordinates are unit-space (0..1); coverage is anti-aliased over one
// supersample pixel.
function rrCoverage(px, py, x, y, w, h, r, invS) {
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const d = Math.hypot(px - cx, py - cy) - r;
  if (d <= -invS) return 1;
  if (d >= invS) return 0;
  return 0.5 - d / invS / 2;
}

function over(dst, sr, sg, sb, sa) {
  const a = sa + dst[3] * (1 - sa);
  if (a <= 0) return;
  dst[0] = (sr * sa + dst[0] * dst[3] * (1 - sa)) / a;
  dst[1] = (sg * sa + dst[1] * dst[3] * (1 - sa)) / a;
  dst[2] = (sb * sa + dst[2] * dst[3] * (1 - sa)) / a;
  dst[3] = a;
}

// The mark: a rounded tile carrying the brand ramp, with three stacked
// "tab" bars whose widths and opacities step down. Sized so the 16px render
// still lands each bar on a whole pixel.
const RADIUS = 0.22;
const BAR_H = 0.13;
const BAR_GAP = 0.085;
const BAR_LEFT = 0.21;
const BAR_WIDTHS = [0.58, 0.47, 0.36];
const BAR_ALPHA = [1, 0.8, 0.55];

function render(size) {
  const S = size * SS;
  const invS = 1 / S;
  const blockH = BAR_H * 3 + BAR_GAP * 2;
  const top = 0.5 - blockH / 2;
  const buf = Buffer.alloc(S * S * 4);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const v = (y + 0.5) / S;
      const dst = [0, 0, 0, 0];

      const bg = rrCoverage(u, v, 0, 0, 1, 1, RADIUS, invS);
      if (bg > 0) {
        const t = (u + v) / 2;
        over(
          dst,
          (FROM[0] + (TO[0] - FROM[0]) * t) / 255,
          (FROM[1] + (TO[1] - FROM[1]) * t) / 255,
          (FROM[2] + (TO[2] - FROM[2]) * t) / 255,
          bg
        );
      }

      for (let i = 0; i < 3; i++) {
        const cov =
          rrCoverage(u, v, BAR_LEFT, top + i * (BAR_H + BAR_GAP), BAR_WIDTHS[i], BAR_H, BAR_H / 2, invS) *
          BAR_ALPHA[i];
        if (cov > 0) over(dst, 1, 1, 1, cov);
      }

      const o = (y * S + x) * 4;
      if (!Number.isFinite(dst[0]) || !Number.isFinite(dst[3])) {
        throw new Error(`non-finite pixel at ${x},${y} (size ${size})`);
      }
      buf[o] = dst[0] * 255;
      buf[o + 1] = dst[1] * 255;
      buf[o + 2] = dst[2] * 255;
      buf[o + 3] = dst[3] * 255;
    }
  }

  const out = Buffer.alloc(size * size * 4);
  const n = SS * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const o = ((y * SS + sy) * S + (x * SS + sx)) * 4;
          r += buf[o];
          g += buf[o + 1];
          b += buf[o + 2];
          a += buf[o + 3];
        }
      }
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return encodePng(size, size, out);
}

/* ------------------------- self check ------------------------- */
function verify(size, png) {
  const { width, height, rgba } = decodePng(png);
  const px = (x, y) => {
    const o = (y * width + x) * 4;
    return [rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]];
  };
  const near = (p, rgb, tol) =>
    Math.abs(p[0] - rgb[0]) <= tol && Math.abs(p[1] - rgb[1]) <= tol && Math.abs(p[2] - rgb[2]) <= tol;

  const problems = [];
  if (width !== size || height !== size) problems.push(`expected ${size}x${size}, got ${width}x${height}`);

  const mid = Math.floor(size / 2);
  const centre = px(mid, mid);
  if (centre[3] < 250) problems.push(`centre is not opaque (alpha ${centre[3]})`);

  const corner = px(0, 0);
  if (corner[3] > 40) problems.push(`top-left corner should be transparent (alpha ${corner[3]})`);

  // The centre bar row must be the white mark, not the ramp.
  const blockH = BAR_H * 3 + BAR_GAP * 2;
  const top = 0.5 - blockH / 2;
  const barRow = Math.floor((top + BAR_H / 2) * size);
  const bar = px(mid, Math.min(size - 1, Math.max(0, barRow)));
  if (bar[3] < 250 || !near(bar, WHITE, 26)) problems.push(`top bar should be white, got ${bar.slice(0, 3)}`);

  // The ramp runs along u+v, so sample two points on the main diagonal —
  // any anti-diagonal pair would share a gradient stop.
  const tl = px(Math.round(size * 0.12), Math.round(size * 0.12));
  const br = px(Math.round(size * 0.88), Math.round(size * 0.88));
  const spread = Math.abs(tl[0] - br[0]) + Math.abs(tl[1] - br[1]) + Math.abs(tl[2] - br[2]);
  if (size >= 32 && spread < 24) problems.push(`gradient too flat (channel spread ${spread})`);

  const hues = new Set();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] > 250) hues.add(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`);
  }
  if (size >= 32 && hues.size < 12) problems.push(`only ${hues.size} opaque colours, expected a gradient`);

  return problems;
}

let failed = false;
for (const size of SIZES) {
  const png = render(size);
  const problems = verify(size, png);
  const file = join(OUT, `icon${size}.png`);
  writeFileSync(file, png);
  console.log(`assets/icon${size}.png  ${png.length} bytes  ${problems.length ? "FAIL" : "ok"}`);
  for (const p of problems) {
    console.error(`  ! icon${size}: ${p}`);
    failed = true;
  }
}
if (failed) {
  console.error("icon generation failed");
  process.exit(1);
}
console.log(`ramp rgb(${FROM.join(",")}) -> rgb(${TO.join(",")})`);
