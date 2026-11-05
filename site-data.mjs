import { ensureSeed } from "../lib/seed.mjs";
import { getStore } from "@netlify/blobs";
import {
  json, verifyCred, makeRecord, rateCheck, rateFail, rateClear,
  createSession, endSession, endAllSessions, authed, logEvent,
  sessionOf, verifyPassLogin, credOf, PASS_MIN, readUsers, okUser, ROLES, endUserSessions,
} from "../lib/auth.mjs";

const MAX_BYTES = 4.5 * 1024 * 1024; // Netlify request bodies cap near 6 MB
const KEEP_BACKUPS = 20;
const isHex64 = (s) => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

async function listBackups(store) {
  const { blobs } = await store.list({ prefix: "backup:site:" });
  return blobs.map((b) => +b.key.slice(12)).filter(Boolean).sort((a, b) => b - a);
}
async function backupCurrent(store) {
  const cur = await store.get("site", { type: "json" });
  if (!cur) return;
  await store.setJSON("backup:site:" + (cur.savedAt || Date.now()), cur);
  const all = await listBackups(store);
  await Promise.all(all.slice(KEEP_BACKUPS).map((t) => store.delete("backup:site:" + t)));
}

/* Content rules for TEAM EDITORS. An editor must not be able to plant script that later runs in the owner's browser
   (the owner's session lives in that browser). The owner is trusted and is not checked. Returns an error text or "". */
const SCHEME = /^\s*[a-z][a-z0-9+.\-]*:/i, WEB = /^\s*https?:/i;
const IMG_OK = /^(\/(?!\/)|https?:\/\/|data:image\/(png|jpe?g|gif|webp|avif);base64,)/i;
const DOC_OK = /^data:([a-z0-9.+\/-]*);base64,[A-Za-z0-9+\/=]*$/i;
const BAD_MIME = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml|text\/javascript|application\/javascript)$/i;
function unsafeContent(d) {
  let bad = "";
  const walk = (v, depth) => {
    if (bad || depth > 12) return;
    if (typeof v === "string") {
      const t = v.slice(0, 64).replace(/[\u0000-\u0020\u00a0]+/g, "").toLowerCase();
      if (/^(javascript|vbscript):/.test(t) || /^data:(text\/html|application\/xhtml|image\/svg)/.test(t)) bad = "A link or file address uses a type that is not allowed (javascript: / html data).";
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (v && typeof v === "object") Object.values(v).forEach((x) => walk(x, depth + 1));
  };
  walk(d, 0);
  if (bad) return bad;
  const arr = (k) => (Array.isArray(d[k]) ? d[k].filter((x) => x && typeof x === "object") : []);
  for (const x of arr("docs")) {
    if (typeof x.url === "string" && x.url) { const m = DOC_OK.exec(x.url); if (!m || BAD_MIME.test(m[1])) return "A document file is not in an allowed format."; }
  }
  const web = (v) => v === undefined || v === "" || typeof v !== "string" || !SCHEME.test(v) || WEB.test(v);
  for (const x of arr("arts")) if (!web(x.src)) return "An article source link must be a normal web address (https://...).";
  for (const x of arr("pages")) if (!web(x.url)) return "A page link must be a normal web address (https://...).";
  for (const x of arr("slides")) if (!web(x.url)) return "A slide link must be a normal web address (https://...).";
  const img = (v) => v === undefined || v === "" || (typeof v === "string" && IMG_OK.test(v));
  for (const x of arr("slides")) if (!img(x.img)) return "A slide picture address is not allowed.";
  for (const x of arr("arts")) { if (!img(x.img) || (Array.isArray(x.imgs) && !x.imgs.every(img))) return "An article picture address is not allowed."; }
  for (const x of arr("gal")) if (!img(x.img)) return "A gallery picture address is not allowed.";
  for (const x of arr("vids")) if (!img(x.thumb)) return "A video cover picture address is not allowed.";
  return "";
}

export default async (req) => {
  await ensureSeed(); // restores a backup on a new site (once)
  const store = getStore({ name: "maskan", consistency: "strong" }); // strong: a save is visible to the very next save/read

  if (req.method === "GET") {
    const site = await store.get("site", { type: "json" });
    return site ? json(site) : json({ error: "empty" }, 404);
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const text = await req.text();
  if (text.length > MAX_BYTES) return json({ error: "Your site content is too large to save (limit 4.5 MB). Remove some large images." }, 413);
  let body;
  try { body = JSON.parse(text); } catch (e) { return json({ error: "bad json" }, 400); }
  if (!body || typeof body !== "object") return json({ error: "bad json" }, 400);

  // ---- public action: username + password sign-in (rate limited) ----
  if (body.action === "login") {
    const rc = await rateCheck(store, req);
    if (rc.locked) return json({ error: "locked", wait: rc.wait }, 429);
    const who = await verifyPassLogin(store, body.user, body.pass);
    if (who) {
      await rateClear(store, rc);
      await logEvent(store, req, "login", "Signed in", who.user);
      const s = await createSession(store, who);
      return json({ ok: true, token: s.token, exp: s.exp, user: who.user, role: who.role });
    }
    const r = await rateFail(store, rc);
    await logEvent(store, req, "login-failed", "Wrong username or password");
    return r.until > Date.now() ? json({ error: "locked", wait: r.until - Date.now() }, 429) : json({ error: "denied" }, 401);
  }

  // ---- everything else needs a valid session ----
  const me = await sessionOf(req, store);
  if (!me) return json({ error: "denied" }, 401);
  const token = me.token, who = me.user, isOwner = me.role === "owner";
  const ownerOnly = () => json({ error: "Only the site owner can do this." }, 403);

  switch (body.action) {
    case "session":
      return json({ ok: true, user: me.user, role: me.role });
    case "users": {
      if (!isOwner) return ownerOnly();
      const u = await readUsers(store);
      return json({ ok: true, users: Object.entries(u).map(([name, v]) => ({ name, role: v.role, at: v.at })) });
    }
    case "adduser": {
      if (!isOwner) return ownerOnly();
      const name = String(body.user || "").toLowerCase();
      if (!okUser(name)) return json({ error: "Username: 4-40 letters, numbers, . _ @ or -" }, 400);
      if (!ROLES.includes(body.role)) return json({ error: "bad role" }, 400);
      if (typeof body.newPass !== "string" || body.newPass.length < PASS_MIN) return json({ error: "Password needs at least " + PASS_MIN + " characters." }, 400);
      const newCred = credOf(name, body.newPass);
      if (!newCred) return json({ error: "bad credential" }, 400);
      const u = await readUsers(store);
      if (name === who && !u[name]) return json({ error: "That is the owner's own username. Pick a different username for the team member." }, 400);
      const existed = !!u[name];
      u[name] = { role: body.role, rec: makeRecord(newCred), at: Date.now() };
      await store.setJSON("users", u);
      if (existed) await endUserSessions(store, name);
      await logEvent(store, req, "account", (existed ? "Updated team account " : "Added team account ") + name + " (" + body.role + ")", who);
      return json({ ok: true });
    }
    case "deluser": {
      if (!isOwner) return ownerOnly();
      const name = String(body.user || "").toLowerCase();
      if (name === who) return json({ error: "You can't remove the account you are signed in with." }, 400);
      const u = await readUsers(store);
      if (!u[name]) return json({ error: "Account not found." }, 404);
      delete u[name];
      await store.setJSON("users", u);
      await endUserSessions(store, name);
      await logEvent(store, req, "account", "Removed team account " + name, who);
      return json({ ok: true });
    }
    case "logout":
      await endSession(store, token);
      await logEvent(store, req, "logout", "Signed out", who);
      return json({ ok: true });
    case "setcred": {
      if (!isOwner || (await readUsers(store))[who]) return json({ error: "Team members change their password from the owner's Team screen." }, 403);
      const curCred = credOf(String(body.currentUser || "").trim(), body.currentPass);
      if (!curCred || !(await verifyCred(store, curCred))) return json({ error: "Current username or password is incorrect." }, 403);
      const newUser = String(body.newUser || "").trim();
      if (newUser.length < 4) return json({ error: "Username needs at least 4 characters." }, 400);
      if (typeof body.newPass !== "string" || body.newPass.length < PASS_MIN) return json({ error: "Password needs at least " + PASS_MIN + " characters." }, 400);
      const newCred = credOf(newUser, body.newPass);
      if (!newCred) return json({ error: "bad credential" }, 400);
      await store.set("cred", makeRecord(newCred));
      await endAllSessions(store, token); // sign out every other device
      await logEvent(store, req, "account", "Changed owner username/password; other devices signed out", who);
      return json({ ok: true });
    }
    case "log":
      if (!isOwner) return ownerOnly();
      return json({ ok: true, log: (await store.get("log", { type: "json" })) || [] });
    case "backups":
      return json({ ok: true, backups: await listBackups(store) });
    case "restore": {
      if (!isOwner) return ownerOnly();
      const at = Number(body.at);
      const b = Number.isFinite(at) && (await store.get("backup:site:" + at, { type: "json" }));
      if (!b) return json({ error: "Backup not found." }, 404);
      await backupCurrent(store);
      const savedAt = Date.now();
      await store.setJSON("site", { savedAt, data: b.data });
      await logEvent(store, req, "restore", "Restored backup from " + new Date(at).toISOString(), who);
      return json({ ok: true, savedAt, data: b.data });
    }
  }

  // ---- save (default action) with version check ----
  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) return json({ error: "no data" }, 400);
  const cur = await store.get("site", { type: "json" });
  const curAt = (cur && cur.savedAt) || 0;
  // Conflict only when the stored copy is NEWER than the version this editor started from.
  // (Using !== wrongly flagged our own previous save when a read came back stale.)
  if (!body.force && curAt && curAt > Number(body.base || 0)) {
    return json({ error: "conflict", savedAt: curAt }, 409);
  }
  if (!isOwner) {
    const why = unsafeContent(body.data);
    if (why) return json({ error: why + " Ask the site owner if you need this." }, 400);
    const a = (cur && cur.data && cur.data.seo) || {}, b = body.data.seo || {};
    if ((a.ads || "") !== (b.ads || "") || (a.head || "") !== (b.head || ""))
      return json({ error: "Only the site owner can change the AdSense ID or custom head code." }, 403);
  }
  await backupCurrent(store);
  const savedAt = Math.max(Date.now(), curAt + 1);
  await store.setJSON("site", { savedAt, data: body.data });
  const LABELS = { title: "site name", logo: "logo", accent: "colours", accentCustom: "colours", siteBg: "colours", surface: "colours", nav: "menu", delay: "slider speed", slides: "hero slider", boxes: "tool boxes", docs: "documents", pages: "pages", arts: "articles", vids: "video library", vidNav: "menu", gal: "image gallery", galNav: "menu", seo: "SEO & AdSense", banner: "banner", notes: "alerts", perf: "speed settings", panels: "imported admin panels" };
  const prev = (cur && cur.data) || {};
  const changed = [...new Set(Object.keys(body.data).filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(body.data[k])).map((k) => LABELS[k] || k))];
  await logEvent(store, req, "publish", changed.length ? "Changed: " + changed.join(", ") : "Published (no content changes)", who);
  return json({ ok: true, savedAt });
};

export const config = { path: "/api/site-data" };
