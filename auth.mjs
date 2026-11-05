// Shared server-side security helpers for all Netlify Functions.
//  - Admin credential is stored only on the server, salted + PBKDF2-hashed (legacy SHA-256 records upgrade on first login).
//  - Login issues a random, expiring session token. Only a hash of the token is stored.
//  - Failed logins are rate-limited per IP on the server.
import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

// First-login credential comes from Netlify environment variables (never hardcoded).
// Set ADMIN_USERNAME and ADMIN_PASSWORD in Netlify > Site settings > Environment variables.
// Once the admin changes the login in the panel, the stored salted hash is used instead.
const initialCred = () => {
  const u = (process.env.ADMIN_USERNAME || "").trim(), p = process.env.ADMIN_PASSWORD || "";
  return u && p ? createHash("sha256").update(u + ":" + p).digest("hex") : null;
};
const ITER = 210000;
/* ADMIN_NO_LOGIN=true (Netlify environment variable) turns the sign-in off: anyone who opens /admin is the owner.
   Used by the site copy inside a downloaded backup. Remove the variable to bring the login back. */
export const OPEN_ADMIN = () => /^(1|true|yes|on)$/i.test((process.env.ADMIN_NO_LOGIN || "").trim());
export const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_FAILS = 5, LOCK_MS = 15 * 60 * 1000;

export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const eq = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const isHex64 = (s) => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
const derive = (cred, salt, iter = ITER) => pbkdf2Sync(cred, salt, iter, 32, "sha256").toString("hex");
export const makeRecord = (cred) => {
  const salt = randomBytes(16).toString("hex");
  return JSON.stringify({ v: 2, salt, iter: ITER, hash: derive(cred, salt) });
};

async function readRecord(store) {
  const raw = await store.get("cred");
  if (!raw) return { legacy: initialCred() };
  if (isHex64(raw)) return { legacy: raw };
  try { return JSON.parse(raw); } catch (e) { return { legacy: initialCred() }; }
}

/* Recovery login: the username + password set in Netlify environment variables ALWAYS work for the owner,
   even when another login was saved earlier (e.g. a site restored from a backup or an old forgotten password).
   Username is not case-sensitive; spaces around the values are ignored. */
const envCreds = () => {
  const u = (process.env.ADMIN_USERNAME || "").trim(), p0 = process.env.ADMIN_PASSWORD || "", p1 = p0.trim();
  if (!u || !p1) return [];
  const out = new Set();
  for (const name of [u, u.toLowerCase()]) for (const p of [p0, p1]) out.add(createHash("sha256").update(name + ":" + p).digest("hex"));
  return [...out];
};
export const isEnvCred = (cred) => isHex64(cred) && envCreds().some((c) => eq(c, cred));

export async function verifyCred(store, cred) {
  if (!isHex64(cred)) return false;
  if (isEnvCred(cred)) return true;
  const rec = await readRecord(store);
  if (rec.legacy === null) return false; // no stored login and no env login configured
  if (rec.legacy) {
    if (!eq(cred, rec.legacy)) return false;
    await store.set("cred", makeRecord(cred)); // upgrade in place, same login keeps working
    return true;
  }
  return eq(derive(cred, rec.salt, rec.iter || ITER), rec.hash);
}

/* The browser sends the username and the password (over HTTPS); the server builds the credential itself,
   so no replayable hash ever travels or is accepted from the client. Same value as before = no migration needed. */
export const credOf = (user, pass) =>
  typeof user === "string" && typeof pass === "string" && user.length > 0 && user.length <= 80 && pass.length > 0 && pass.length <= 200
    ? sha256(user + ":" + pass) : null;
export const PASS_MIN = 10;
export async function verifyPassLogin(store, user, pass) {
  const u = typeof user === "string" ? user.trim() : "";
  if (typeof pass === "string") for (const p of new Set([pass, pass.trim()])) for (const name of new Set([u, u.toLowerCase()])) {
    const c = credOf(name, p); if (c && isEnvCred(c)) return { user: "owner", role: "owner" };
  }
  for (const name of new Set([u, u.toLowerCase()])) {
    const c = credOf(name, pass);
    if (c) { const w = await verifyLogin(store, u, c); if (w) return w; }
  }
  return null;
}

const ipOf = (req) =>
  req.headers.get("x-nf-client-connection-ip") ||
  (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";

export async function rateCheck(store, req) {
  const k = "rl:" + sha256(ipOf(req));
  const r = (await store.get(k, { type: "json" })) || { n: 0, until: 0 };
  return { key: k, rec: r, locked: r.until > Date.now(), wait: Math.max(0, r.until - Date.now()) };
}
export async function rateFail(store, rc) {
  const r = rc.rec.until && rc.rec.until < Date.now() ? { n: 0, until: 0 } : rc.rec;
  r.n++;
  if (r.n >= MAX_FAILS) { r.until = Date.now() + LOCK_MS; r.n = 0; }
  await store.setJSON(rc.key, r);
  return r;
}
export const rateClear = (store, rc) => store.delete(rc.key);

export async function createSession(store, who = { user: "owner", role: "owner" }) {
  const token = randomBytes(32).toString("hex");
  const exp = Date.now() + SESSION_MS;
  await store.setJSON("session:" + sha256(token), { exp, user: who.user, role: who.role });
  return { token, exp };
}
export async function endSession(store, token) {
  if (isHex64(token)) await store.delete("session:" + sha256(token));
}
export async function endAllSessions(store, keepToken) {
  const keep = keepToken ? "session:" + sha256(keepToken) : "";
  const { blobs } = await store.list({ prefix: "session:" });
  await Promise.all(blobs.filter((b) => b.key !== keep).map((b) => store.delete(b.key)));
}

/** Returns the session token if the request carries a valid, unexpired session; otherwise null. */
export async function authed(req, store) {
  const token = req.headers.get("x-admin-token");
  if (!isHex64(token)) return null;
  if (OPEN_ADMIN()) return token; // no-login mode: the admin panel opens without sign-in (see ADMIN_NO_LOGIN)
  const k = "session:" + sha256(token);
  const s = await store.get(k, { type: "json" });
  if (!s) return null;
  if (s.exp < Date.now()) { await store.delete(k); return null; }
  return token;
}

/** Like authed(), but returns { token, user, role }. Sessions created before roles existed are the owner. */
export async function sessionOf(req, store) {
  const token = await authed(req, store);
  if (!token) return null;
  const s = (await store.get("session:" + sha256(token), { type: "json" })) || {};
  return { token, user: s.user || "owner", role: s.role || "owner" };
}

/* ---------- team accounts (owner + editors) ----------
   The original single login stays the OWNER account (blob "cred").
   Extra accounts live in blob "users": { [username]: { role: "editor"|"owner", rec: <salted hash>, at } }.
   The browser sends sha256(username + ":" + password) as before, plus the username so we know which record to check. */
export const ROLES = ["owner", "editor"];
export const okUser = (u) => typeof u === "string" && /^[a-zA-Z0-9._@-]{4,40}$/.test(u);
export const readUsers = async (store) => (await store.get("users", { type: "json" })) || {};
export async function verifyLogin(store, user, cred) {
  if (!isHex64(cred)) return null;
  const users = await readUsers(store);
  const key = okUser(user) ? user.toLowerCase() : "";
  if (key && users[key]) {
    const r = JSON.parse(users[key].rec);
    return eq(derive(cred, r.salt, r.iter || ITER), r.hash) ? { user: key, role: users[key].role } : null;
  }
  return (await verifyCred(store, cred)) ? { user: key || "owner", role: "owner" } : null;
}
/** Ends every session belonging to one team member (used when an account is removed or its role changes). */
export async function endUserSessions(store, user) {
  const { blobs } = await store.list({ prefix: "session:" });
  for (const b of blobs) { const s = await store.get(b.key, { type: "json" }); if (s && s.user === user) await store.delete(b.key); }
}

/** Activity log: keeps the newest 300 admin events in the "log" blob. Never stores passwords or tokens. */
export async function logEvent(store, req, action, detail = "", who = "") {
  try {
    const list = (await store.get("log", { type: "json" })) || [];
    const ip = ipOf(req);
    list.unshift({ at: Date.now(), who: String(who || "").slice(0, 40), action, detail: String(detail).slice(0, 300), ip: ip === "unknown" ? "" : ip.replace(/(\.\d+)$|(:[0-9a-f]*)$/i, ".x"), ua: (req.headers.get("user-agent") || "").slice(0, 120) });
    await store.setJSON("log", list.slice(0, 300));
  } catch (e) { /* logging must never break the request */ }
}
