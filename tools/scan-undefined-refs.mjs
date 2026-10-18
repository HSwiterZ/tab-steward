/**
 * Find identifiers that are used bare in a module but neither imported nor
 * declared there — the class of bug tools/check-imports.mjs cannot see
 * (it only validates that named imports exist in their source module).
 *
 *   node tools/scan-undefined-refs.mjs [dir=src]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.argv[2] || "src";
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith(".js")) files.push(p);
  }
})(ROOT);

const stripNonCode = (code) =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/(["'`])(?:\\.|(?!\1)[\s\S])*?\1/g, '""');

/** Import/export statements are declarations, not uses — blanked out separately. */
const stripModuleStatements = (code) =>
  code
    .replace(/import\s+[\s\S]*?from\s*["'][^"']*["']\s*;?/g, " ")
    .replace(/import\s*["'][^"']*["']\s*;?/g, " ")
    .replace(/export\s+[\s\S]*?from\s*["'][^"']*["']\s*;?/g, " ");

const namesInBraces = (s) =>
  s
    .split(",")
    .map((part) => part.trim().split(/\s+as\s+/).pop().trim())
    .filter(Boolean);

const sources = new Map();
const imports = new Map();
for (const f of files) {
  const raw = readFileSync(f, "utf8");
  const code = stripNonCode(raw);
  sources.set(f, stripModuleStatements(code));
  const bound = new Set();
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from/g)) for (const n of namesInBraces(m[1])) bound.add(n);
  for (const m of code.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) bound.add(m[1]);
  for (const m of code.matchAll(/export\s*\{([^}]*)\}\s*from/g)) for (const n of namesInBraces(m[1])) bound.add(n);
  imports.set(f, bound);
}

const exported = new Set();
for (const code of sources.values()) {
  for (const m of code.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) exported.add(m[1]);
}

const problems = [];
for (const [file, code] of sources) {
  const bound = new Set(imports.get(file));
  const addParams = (s) => {
    for (const p of s.split(",")) {
      const n = p.trim().replace(/[{}[\]():\s=?]/g, "").split(/[\s=]/)[0];
      if (n) bound.add(n);
    }
  };
  for (const m of code.matchAll(/(?:^|\s|;|\{)(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);
  for (const m of code.matchAll(/async\s+function\s*[\w$]*\s*\(([^)]*)\)/g)) addParams(m[1]);
  for (const m of code.matchAll(/function\s*[\w$]*\s*\(([^)]*)\)/g)) addParams(m[1]);
  for (const m of code.matchAll(/\(([^)]*)\)\s*=>/g)) addParams(m[1]);
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) bound.add(m[1]);
  for (const m of code.matchAll(/for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);
  for (const m of code.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);
  for (const m of code.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) addParams(m[1]);
  for (const m of code.matchAll(/(?:const|let|var)\s*\[([^\]]*)\]\s*=/g)) addParams(m[1]);
  // destructured parameters with defaults: function f({ now = Date.now() } = {})
  for (const m of code.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*=[^=]/g)) bound.add(m[1]);

  for (const name of exported) {
    if (bound.has(name)) continue;
    // `name:` is an object key and `name(args) {` is a method definition — neither is a use
    const re = new RegExp("(^|[^.\\w$'\"])\\b" + name + "\\b(?!\\s*:)", "g");
    const hits = [...code.matchAll(re)].filter((m) => !/^\s*\([^()]*\)\s*\{/.test(code.slice(m.index + m[0].length)));
    if (hits.length) problems.push({ file, name, line: code.slice(0, hits[0].index).split("\n").length, uses: hits.length });
  }
}

if (!problems.length) {
  console.log("no used-but-not-imported identifiers");
} else {
  for (const p of problems) console.log(`  ${relative(".", p.file)}:${p.line}  ${p.name}  (${p.uses} bare uses, neither imported nor declared)`);
  process.exit(1);
}
