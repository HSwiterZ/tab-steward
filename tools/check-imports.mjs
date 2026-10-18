/**
 * Static import/export consistency check (no bundler, no deps).
 * Verifies every named import resolves to a real export in the target module.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), ".."));
const SRC = join(ROOT, "src");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

function exportsOf(source) {
  const names = new Set();
  const re = /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_$]+)/g;
  let m;
  while ((m = re.exec(source))) names.add(m[1]);
  const brace = /export\s*\{([^}]*)\}/g;
  while ((m = brace.exec(source))) {
    for (const part of m[1].split(",")) {
      const piece = part.trim();
      if (!piece) continue;
      const as = piece.split(/\s+as\s+/);
      names.add((as[1] || as[0]).trim());
    }
  }
  if (/export\s+default/.test(source)) names.add("default");
  return names;
}

function importsOf(source) {
  const out = [];
  const re = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(source))) {
    const clause = m[1];
    const spec = m[2];
    const named = clause.match(/\{([\s\S]*)\}/);
    if (!named) continue;
    for (const part of named[1].split(",")) {
      const piece = part.trim();
      if (!piece) continue;
      const as = piece.split(/\s+as\s+/);
      out.push({ name: as[0].trim(), spec });
    }
  }
  return out;
}

const files = walk(SRC);
const cache = new Map();
const exportedBy = (file) => {
  if (!cache.has(file)) cache.set(file, exportsOf(readFileSync(file, "utf8")));
  return cache.get(file);
};

let problems = 0;
for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const { name, spec } of importsOf(source)) {
    if (!spec.startsWith(".")) continue;
    let target = resolve(dirname(file), spec);
    if (!target.endsWith(".js")) target += ".js";
    if (!files.includes(target)) {
      console.log(`MISSING FILE  ${relative(ROOT, file)} -> ${spec}`);
      problems++;
      continue;
    }
    if (!exportedBy(target).has(name)) {
      console.log(`NO EXPORT     ${relative(ROOT, file)} imports "${name}" from ${spec}`);
      problems++;
    }
  }
}
console.log(problems ? `\n${problems} problem(s)` : "imports OK");
process.exit(problems ? 1 : 0);
