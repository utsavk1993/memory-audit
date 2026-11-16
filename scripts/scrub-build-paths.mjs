// Before packing: replace the absolute folder this was built in (which contains the builder's username)
// with a neutral path in every shipped .next text file. `next start` works the same either way.
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, ".next");
const SKIP = new Set(["cache", "dev"]);
let changed = 0;

async function walk(d) {
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (!(d === dir && SKIP.has(e.name))) await walk(p);
    } else if (/\.(json|js|mjs|cjs|map|html|txt|rsc|meta|body)$/.test(e.name)) {
      const s = await readFile(p, "utf8");
      if (s.includes(root)) {
        await writeFile(p, s.split(root).join("/build/memory-audit"));
        changed += 1;
      }
    }
  }
}

await walk(dir);
console.log(`scrub-build-paths: cleaned ${changed} file(s)`);
