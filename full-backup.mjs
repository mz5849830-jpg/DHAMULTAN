
import {createRequire as ___nfyCreateRequire} from "module";
import {fileURLToPath as ___nfyFileURLToPath} from "url";
import {dirname as ___nfyPathDirname} from "path";
let __filename=___nfyFileURLToPath(import.meta.url);
let __dirname=___nfyPathDirname(___nfyFileURLToPath(import.meta.url));
let require=___nfyCreateRequire(import.meta.url);


// netlify/functions/full-backup.mjs
import { getStore } from "@netlify/blobs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

// netlify/lib/auth.mjs
import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
var OPEN_ADMIN = () => /^(1|true|yes|on)$/i.test((process.env.ADMIN_NO_LOGIN || "").trim());
var SESSION_MS = 12 * 60 * 60 * 1e3;
var LOCK_MS = 15 * 60 * 1e3;
var json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
});
var sha256 = (s) => createHash("sha256").update(s).digest("hex");
var isHex64 = (s) => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
var ipOf = (req) => req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
async function authed(req, store) {
  const token = req.headers.get("x-admin-token");
  if (!isHex64(token)) return null;
  if (OPEN_ADMIN()) return token;
  const k = "session:" + sha256(token);
  const s = await store.get(k, { type: "json" });
  if (!s) return null;
  if (s.exp < Date.now()) {
    await store.delete(k);
    return null;
  }
  return token;
}
async function sessionOf(req, store) {
  const token = await authed(req, store);
  if (!token) return null;
  const s = await store.get("session:" + sha256(token), { type: "json" }) || {};
  return { token, user: s.user || "owner", role: s.role || "owner" };
}
async function logEvent(store, req, action, detail = "", who = "") {
  try {
    const list = await store.get("log", { type: "json" }) || [];
    const ip = ipOf(req);
    list.unshift({ at: Date.now(), who: String(who || "").slice(0, 40), action, detail: String(detail).slice(0, 300), ip: ip === "unknown" ? "" : ip.replace(/(\.\d+)$|(:[0-9a-f]*)$/i, ".x"), ua: (req.headers.get("user-agent") || "").slice(0, 120) });
    await store.setJSON("log", list.slice(0, 300));
  } catch (e) {
  }
}

// netlify/functions/full-backup.mjs
var STORES = ["maskan", "maskan-media", "maskan-tools"];
var PRIVATE = (store, key) => store === "maskan" && (key === "cred" || key === "users" || key === "log" || key === "seed:done" || /^(session:|rl:)/.test(key)) || store === "maskan-media" && key.startsWith("p/") || // unfinished video uploads
store === "maskan-tools" && /^(zu\/|zt\/)/.test(key);
var SRC_ROOTS = ["public", "netlify", "docs", "netlify.toml", "package.json"];
var SKIP = /(^|\/)(node_modules|\.git|\.netlify|backup-data)(\/|$)/;
var BASES = () => [process.cwd(), "/var/task", new URL("../../", import.meta.url).pathname];
async function walk(base, rel, out) {
  if (SKIP.test(rel)) return;
  let st;
  try {
    st = await stat(join(base, rel));
  } catch {
    return;
  }
  if (st.isDirectory()) {
    for (const n of await readdir(join(base, rel))) await walk(base, rel + "/" + n, out);
  } else if (st.size < 8 * 1024 * 1024) out[rel] = (await readFile(join(base, rel))).toString("base64");
}
var full_backup_default = async (req) => {
  const main = getStore({ name: "maskan", consistency: "strong" });
  const me = await sessionOf(req, main);
  if (!me) return json({ error: "denied" }, 401);
  if (me.role !== "owner") return json({ error: "Only the site owner can download a full backup." }, 403);
  const u = new URL(req.url), a = u.searchParams.get("a");
  if (a === "source") {
    for (const base of BASES()) {
      const files = {};
      for (const r of SRC_ROOTS) await walk(base, r, files);
      if (files["public/app.html"]) {
        await logEvent(main, req, "backup", "Downloaded full website backup", me.user);
        return json({ ok: true, files });
      }
    }
    return json({ error: "Source files are not available on the server. Redeploy the site from the full source (with netlify.toml)." }, 500);
  }
  if (a === "list") {
    const items = [];
    for (const s of STORES) {
      const { blobs } = await getStore({ name: s, consistency: "strong" }).list();
      for (const b of blobs) if (!PRIVATE(s, b.key)) items.push({ s, k: b.key });
    }
    return json({ ok: true, items });
  }
  if (a === "get") {
    const s = u.searchParams.get("s"), k = u.searchParams.get("k") || "";
    if (!STORES.includes(s) || !k || PRIVATE(s, k)) return json({ error: "not allowed" }, 403);
    const r = await getStore({ name: s, consistency: "strong" }).getWithMetadata(k, { type: "arrayBuffer" });
    if (!r) return json({ error: "missing" }, 404);
    return new Response(r.data, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "X-Meta": encodeURIComponent(JSON.stringify(r.metadata || {})) } });
  }
  return json({ error: "unknown action" }, 400);
};
var config = { path: "/api/full-backup" };
export {
  PRIVATE,
  STORES,
  config,
  full_backup_default as default
};
