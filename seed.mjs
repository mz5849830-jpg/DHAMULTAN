// Restores a website backup on a brand-new Netlify site.
// A backup ZIP carries its data in /backup-data (manifest.json + one file per stored item).
// The first request on the new site copies that data into Netlify Blobs once. Existing data is never overwritten.
// No login is restored: the new owner signs in with ADMIN_USERNAME / ADMIN_PASSWORD set in Netlify environment variables.
import { getStore } from "@netlify/blobs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

let DONE = false, RUN = null;
const BASES = () => [process.cwd(), "/var/task", new URL("../../", import.meta.url).pathname];

async function findManifest() {
  for (const b of BASES()) {
    try { return { base: join(b, "backup-data"), man: JSON.parse(await readFile(join(b, "backup-data", "manifest.json"), "utf8")) }; } catch {}
  }
  return null;
}

async function run() {
  const main = getStore({ name: "maskan", consistency: "strong" });
  if (await main.get("seed:done")) return;
  const found = await findManifest();
  if (!found) return;
  const stores = {};
  const st = (n) => (stores[n] ||= getStore({ name: n, consistency: "strong" }));
  const items = found.man.items || [];
  for (let i = 0; i < items.length; i += 10) {
    await Promise.all(items.slice(i, i + 10).map(async (it) => {
      const s = st(it.s);
      if (await s.get(it.k)) return; // never overwrite live data
      const buf = await readFile(join(found.base, it.f));
      await s.set(it.k, buf, { metadata: it.m || {} });
    }));
  }
  await main.set("seed:done", String(Date.now()));
}

/** Call at the start of a function. Cheap after the first run. Never throws. */
export async function ensureSeed() {
  if (DONE) return;
  try { await (RUN ||= run()); DONE = true; } catch (e) { RUN = null; console.error("backup restore failed", e); }
}
