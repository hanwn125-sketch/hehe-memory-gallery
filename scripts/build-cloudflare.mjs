import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const out = join(root, "out");
const entries = [
  ".nojekyll",
  "_headers",
  "app.js",
  "food-map.css",
  "food-map.html",
  "food-map.js",
  "index.html",
  "secure",
  "styles.css",
];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const entry of entries) {
  await cp(join(root, entry), join(out, entry), { recursive: true });
}
