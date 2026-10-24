/**
 * Build the Chrome Web Store upload.
 *
 * The repository contains things the browser must never receive: the dev mock,
 * tests, demo recorders, screenshots and the git metadata. Rather than trusting
 * an ignore list, this script walks an explicit allowlist and writes a plain
 * zip with no dependencies.
 *
 *   node tools/pack.mjs
 *
 * Output: dist/tab-steward-<version>.zip
 */
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT_DIR = join(ROOT, "dist");

/** Files and trees that belong in the extension, nothing else. */
const INCLUDE = ["manifest.json", "LICENSE", "THIRD_PARTY_NOTICES.md", "assets", "src"];
/** Dev-only trees; excluded even though they sit under an included root. */
const EXCLUDE = [/^src[\\/]dev[\\/]/];

function walk(entry) {
  const abs = join(ROOT, entry);
  const st = statSync(abs);
  if (st.isFile()) return [entry];
  const out = [];
  for (const name of readdirSync(abs).sort()) {
    const child = join(entry, name);
    if (EXCLUDE.some((re) => re.test(child))) continue;
    out.push(...walk(child));
  }
  return out;
}

/* ---------------------------------------------------------------- zip --- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Fixed 1980-01-01 so two builds of the same tree are byte-identical. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  let rawTotal = 0;
  let packedTotal = 0;

  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    rawTotal += data.length;
    packedTotal += packed.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + packed.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return { buffer: Buffer.concat([...locals, centralBuf, end]), rawTotal, packedTotal };
}

/* -------------------------------------------------------------- build --- */

const names = INCLUDE.flatMap(walk).sort();
const files = names.map((name) => ({
  name: name.split(sep).join("/"),
  data: readFileSync(join(ROOT, name)),
}));

const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
for (const icon of Object.values(manifest.icons)) {
  if (!files.some((f) => f.name === icon.split("/").join("/"))) {
    throw new Error(`manifest icon missing from package: ${icon}`);
  }
}
const forbidden = files.filter((f) =>
  /^(src\/dev\/|tests\/|tools\/|docs\/|store\/|\.github\/|node_modules\/|dist\/)/.test(f.name) ||
  ["package.json", "package-lock.json", ".gitignore", "README.md"].includes(f.name)
);
if (forbidden.length) throw new Error(`forbidden paths in package:\n${forbidden.map((f) => f.name).join("\n")}`);
const devRefs = files.filter((f) => f.name.endsWith(".js") && /from\s+["'][^"']*\/dev\//.test(f.data.toString("utf8")));
if (devRefs.length) throw new Error(`static import into src/dev would break the package: ${devRefs.map((f) => f.name).join(", ")}`);

mkdirSync(OUT_DIR, { recursive: true });
const out = join(OUT_DIR, `tab-steward-${manifest.version}.zip`);
const { buffer, rawTotal, packedTotal } = zip(files);
writeFileSync(out, buffer);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`${relative(ROOT, out)}`);
console.log(`${files.length} files · ${kb(rawTotal)} raw · ${kb(packedTotal)} packed · ${kb(buffer.length)} zip`);
console.log(`manifest ${manifest.version} · ${manifest.name} · src/dev excluded`);
