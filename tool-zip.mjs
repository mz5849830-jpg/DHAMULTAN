import { ensureSeed } from "../lib/seed.mjs";
import { getStore } from "@netlify/blobs";
import { authed as sessionAuthed } from "../lib/auth.mjs";

// ZIP-project storage for the HTML tool boxes.
//  - The admin panel extracts + validates the ZIP in the browser, then uploads each file here.
//  - This function RE-VALIDATES everything (never trust the browser), stores files in Netlify Blobs
//    under an immutable version id, and serves them at /_tool/<boxId>.<version>/<path>.
//  - Every served file carries a CSP "sandbox" header, so even if someone opens a file URL directly
//    it can never run with the website's origin (cookies, localStorage, admin token).


export const LIMITS = {
  MAX_FILE: 5 * 1024 * 1024,        // per file (Netlify Functions accept ~6 MB request bodies)
  MAX_TOTAL: 60 * 1024 * 1024,      // extracted size per tool
  MAX_FILES: 400,
};
const GRACE_MS = 2 * 60 * 60 * 1000; // unpublished uploads are kept 2 h before cleanup

const TYPES = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8", map: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json; charset=utf-8",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", svg: "image/svg+xml", ico: "image/x-icon", bmp: "image/bmp",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac",
  mp4: "video/mp4", webm: "video/webm", ogv: "video/ogg", mov: "video/quicktime",
  xml: "application/xml; charset=utf-8", txt: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8", md: "text/plain; charset=utf-8", pdf: "application/pdf",
};
// Source code in any language can be stored in a Pages ZIP. It is only ever served as plain text (shown, never run).
export const CODE_EXT = ("java kt kts scala groovy gradle py rb php go rs c cc cpp cxx h hpp cs vb fs swift m mm dart lua pl pm r jl " +
  "ts tsx jsx vue svelte astro scss sass less styl sql graphql gql proto yml yaml toml ini cfg conf properties env sh bash zsh bat cmd ps1 " +
  "ipynb tex rst log lock diff patch gitignore dockerfile makefile cmake clj ex exs erl hs ml elm nim zig sol").split(" ");
for (const x of CODE_EXT) TYPES[x] = "text/plain; charset=utf-8";

const CSP = [
  "sandbox allow-scripts allow-forms allow-modals allow-downloads allow-popups allow-popups-to-escape-sandbox",
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com",
  "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https:",
  "frame-src https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

// Small script added to every public HTML page served from a ZIP tool:
//  - gives pages a memory-only localStorage/sessionStorage when the sandbox blocks the real ones (so they don't crash)
//  - hides an in-page "Admin" tab/button from visitors; it is shown only at /tools/<tool>/admin (?adm=1)
//  - lets the page save/load data through window.toolStore (stored by the site, writable only when the admin is signed in)
const INJECT = '<script>(function(){var q=new URLSearchParams(location.search),ADM=q.get("adm")==="1"||/\\/_tool\\/[a-z0-9]+\\.[a-z0-9]+\\.t[a-f0-9]{32}\\//.test(location.pathname);'
+'try{window.localStorage.getItem("x")}catch(e){["localStorage","sessionStorage"].forEach(function(k){var m={};var st={getItem:function(a){return a in m?m[a]:null},setItem:function(a,v){m[a]=String(v)},removeItem:function(a){delete m[a]},clear:function(){m={}},key:function(i){return Object.keys(m)[i]||null}};Object.defineProperty(st,"length",{get:function(){return Object.keys(m).length}});try{Object.defineProperty(window,k,{value:st,configurable:true})}catch(x){}})}'
+'var qq={},n=0;window.addEventListener("message",function(e){var d=e.data;if(d&&d.type==="store-res"&&qq[d.id]){qq[d.id](d);delete qq[d.id]}});'
+'function call(m){return new Promise(function(r){var id=++n;qq[id]=r;parent.postMessage(Object.assign({id:id},m),"*");setTimeout(function(){if(qq[id]){delete qq[id];r({ok:false})}},8000)})}'
+'window.toolStore={load:function(){return call({type:"store-get"}).then(function(r){return r.ok?r.data:null})},save:function(d){return call({type:"store-set",data:d}).then(function(r){return !!r.ok})},isAdmin:ADM};'
+'function sl(t){return(t||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")}'
+'function isA(el){var t=sl(el.textContent);if(t==="admin"||t==="admin-panel"||t==="admin-login"||t==="admin-area")return true;if(t)return false;var a=sl((el.getAttribute&&(el.getAttribute("aria-label")||el.getAttribute("title")))||"");return a==="admin"||/^admin[-_]?(btn|button|link|tab|toggle|open)?$/i.test(el.id||"")}'
+'function tabs(){var out=[];function add(el){var t=(el.textContent||"").trim();if((t||isA(el))&&t.length<=24&&out.indexOf(el)<0)out.push(el)}'
+'document.querySelectorAll("[role=tab],[data-tab],[data-view],[data-page],[class*=tab]>button,[class*=tab]>a,[class*=Tab]>button,[class*=Tab]>a").forEach(add);'
+'document.querySelectorAll("button,a,[role=button]").forEach(function(el){if(isA(el))add(el)});'
+'out.sort(function(a,b){return a.compareDocumentPosition(b)&2?1:-1});return out}'
+'document.addEventListener("click",function(e){var t=e.target.closest&&e.target.closest("button,a,[role=tab],[role=button],[data-tab],[data-view],[data-page]");if(!t)return;var l=tabs(),i=l.indexOf(t);if(i<0)return;parent.postMessage({type:"toolsub",sub:isA(t)?"admin":(i===0?"":sl(t.textContent))},"*")},true);'
+'function hide(){if(ADM)return;var l=tabs(),v=[];l.forEach(function(el){if(isA(el))el.style.setProperty("display","none","important");else v.push(el)});if(v.length<2&&l.length>v.length)v.forEach(function(el){var p=el.parentElement;if(p&&Array.prototype.every.call(p.children,function(c){return l.indexOf(c)>=0}))p.style.setProperty("display","none","important")})}'
+'new MutationObserver(hide).observe(document,{childList:true,subtree:true});hide();'
+'function open(){if(!ADM)return true;var l=tabs();for(var i=0;i<l.length;i++)if(isA(l[i])){l[i].click();return true}return false}'
+'var c=0,iv=setInterval(function(){if(open()||++c>25)clearInterval(iv)},120);'
+'})()</script>';
function injectInto(html) {
  const m = /<head[^>]*>/i.exec(html) || /<html[^>]*>/i.exec(html) || /<!doctype[^>]*>/i.exec(html);
  if (!m) return INJECT + html;
  const at = m.index + m[0].length;
  return html.slice(0, at) + INJECT + html.slice(at);
}

const TICKET_MS = 30 * 60 * 1000; // an admin-panel link stays valid for 30 minutes
const manCache = new Map();       // manifests never change once published, so keep them in memory (saves a storage read per file)
async function getManifest(store, id, v) {
  const k = id + "." + v;
  if (manCache.has(k)) return manCache.get(k);
  const man = await store.get(`zm/${id}/${v}`, { type: "json" });
  if (man) { if (manCache.size >= 300) manCache.delete(manCache.keys().next().value); manCache.set(k, man); }
  return man;
}
const isHtmlPath = (p) => /\.html?$/i.test(p);
const isAdminFile = (man, path) => {
  const a = man.admin;
  if (!a) return false;
  return (a.paths || []).includes(path) || (a.dirs || []).some((d) => path.startsWith(d));
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
const same = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};

const okId = (s) => typeof s === "string" && /^[a-z0-9]{8,32}$/.test(s);
const okVer = (s) => typeof s === "string" && /^[a-z0-9]{6,20}$/.test(s);

export function safePath(p) {
  if (typeof p !== "string" || !p || p.length > 300) return null;
  if (/[\u0000-\u001f\u007f\\#?%:*"<>|]/.test(p)) return null;
  if (p.startsWith("/")) return null;
  const segs = p.split("/");
  if (segs.some((s) => !s || s === "." || s === ".." || s.length > 150 || s.startsWith("."))) return null;
  return p;
}
export const extOf = (p) => {
  const n = p.split("/").pop(), i = n.lastIndexOf(".");
  return i < 0 ? "" : n.slice(i + 1).toLowerCase();
};

async function authed(req, root) {
  return !!(await sessionAuthed(req, root));
}

async function readJson(req) {
  try { return await req.json(); } catch (e) { return null; }
}

async function deleteVersion(store, id, v) {
  const { blobs } = await store.list({ prefix: `zf/${id}/${v}/` });
  for (const b of blobs) await store.delete(b.key);
  await store.delete(`zm/${id}/${v}`);
  await store.delete(`zu/${id}/${v}`);
}

async function serve(req, store) {
  const url = new URL(req.url);
  const rest = url.pathname.replace(/^\/_tool\//, "");
  const slash = rest.indexOf("/");
  const head = slash < 0 ? rest : rest.slice(0, slash);
  const m = /^([a-z0-9]{8,32})\.([a-z0-9]{6,20})(?:\.t([a-f0-9]{32}))?$/.exec(head);
  const notFound = (msg, status = 404) =>
    new Response(msg, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": CSP } });
  if (!m) return notFound("Tool not found.");
  const [, id, v, ticket] = m;
  const man = await getManifest(store, id, v);
  if (!man) return notFound("Tool not found (it may have been replaced or deleted).");

  let path = "";
  try {
    path = slash < 0 ? "" : rest.slice(slash + 1).split("/").map(decodeURIComponent).join("/");
  } catch (e) { return notFound("Bad path."); }
  if (!path) {
    return new Response(null, { status: 302, headers: { Location: `/_tool/${id}.${v}/` + man.entry.split("/").map(encodeURIComponent).join("/"), "Cache-Control": "no-store" } });
  }
  path = safePath(path);
  const info = path && man.files[path];
  if (!info) return notFound("File not found in this tool: " + (path || "bad path"));

  // Admin-panel files are never served on the public address. They need a short-lived ticket
  // that only a signed-in admin can create (see action "ticket" below).
  const priv = isAdminFile(man, path);
  let ticketOk = false;
  if (ticket) {
    const t = await store.get(`zt/${ticket}`, { type: "json" });
    ticketOk = !!(t && t.id === id && t.v === v && t.exp > Date.now());
  }
  if (priv && !ticketOk) return notFound("This is a private admin file. Open it from the website's /admin address after signing in.", 403);

  const buf = await store.get(`zf/${id}/${v}/${path}`, { type: "arrayBuffer" });
  if (!buf) return notFound("File is missing from storage: " + path);

  const isHtml = /^html?$/.test(extOf(path));
  const publicCache = !priv && !ticketOk && !isHtml;
  const headers = {
    "Content-Type": info.ct,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": CSP,
    "Cache-Control": priv || ticketOk ? "private, no-store" : isHtmlPath(path) ? "public, max-age=0, must-revalidate" : "public, max-age=31536000, immutable",
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Referrer-Policy": "no-referrer",
    "Accept-Ranges": "bytes",
  };
  // Versions are immutable, so the CDN may keep static files (not HTML, which depends on ?adm) for a year.
  if (publicCache) headers["Netlify-CDN-Cache-Control"] = "public, max-age=31536000, immutable";

  if (isHtml && !req.headers.get("range")) {
    const out = new TextEncoder().encode(injectInto(new TextDecoder("utf-8").decode(buf)));
    return new Response(req.method === "HEAD" ? null : out, { status: 200, headers: { ...headers, "Content-Length": String(out.byteLength) } });
  }

  const size = buf.byteLength;
  const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") || "");
  if (rg && (rg[1] || rg[2])) {
    let a = rg[1] === "" ? Math.max(0, size - Number(rg[2])) : Number(rg[1]);
    let b = rg[1] === "" || rg[2] === "" ? size - 1 : Math.min(Number(rg[2]), size - 1);
    if (a > b || a >= size) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    return new Response(req.method === "HEAD" ? null : buf.slice(a, b + 1), {
      status: 206, headers: { ...headers, "Content-Range": `bytes ${a}-${b}/${size}` },
    });
  }
  return new Response(req.method === "HEAD" ? null : buf, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
}

export default async (req) => {
  await ensureSeed(); // restores a backup on a new site (once)
  const store = getStore({ name: "maskan-tools", consistency: "strong" });
  const url = new URL(req.url);

  if (url.pathname.startsWith("/_tool/")) {
    if (req.method !== "GET" && req.method !== "HEAD") return json({ error: "method" }, 405);
    return serve(req, store);
  }

  if (req.method !== "POST") return json({ error: "method" }, 405);
  const root = getStore({ name: "maskan", consistency: "strong" });
  if (!(await authed(req, root))) return json({ error: "denied" }, 401);
  const a = url.searchParams.get("a");

  if (a === "begin") {
    const body = await readJson(req);
    if (!body || !okId(body.id)) return json({ error: "bad id" }, 400);
    const v = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    await store.setJSON(`zu/${body.id}/${v}`, { at: Date.now() });
    return json({ ok: true, v, limits: LIMITS });
  }

  if (a === "put") {
    const id = url.searchParams.get("id"), v = url.searchParams.get("v"), p = safePath(url.searchParams.get("p"));
    if (!okId(id) || !okVer(v)) return json({ error: "bad id" }, 400);
    if (!p) return json({ error: "Unsafe or invalid file path." }, 400);
    const ct = TYPES[extOf(p)];
    if (!ct) return json({ error: "File type not allowed: ." + extOf(p) }, 400);
    if (!(await store.get(`zu/${id}/${v}`))) return json({ error: "Upload session not found. Start again." }, 400);
    if (await store.get(`zm/${id}/${v}`)) return json({ error: "This version is already published and cannot change." }, 409);
    const buf = await req.arrayBuffer();
    if (buf.byteLength > LIMITS.MAX_FILE) return json({ error: "File too large (max 5 MB each): " + p }, 413);
    await store.set(`zf/${id}/${v}/${p}`, buf, { metadata: { ct, size: buf.byteLength } });
    return json({ ok: true });
  }

  if (a === "finalize") {
    const b = await readJson(req);
    if (!b || !okId(b.id) || !okVer(b.v) || !Array.isArray(b.files)) return json({ error: "bad request" }, 400);
    if (!(await store.get(`zu/${b.id}/${b.v}`))) return json({ error: "Upload session not found. Start again." }, 400);
    if (await store.get(`zm/${b.id}/${b.v}`)) return json({ error: "Already finalized." }, 409);
    if (b.files.length < 1 || b.files.length > LIMITS.MAX_FILES) return json({ error: "Too many files (max " + LIMITS.MAX_FILES + ")." }, 400);
    const files = {}, seen = new Set();
    let total = 0;
    for (const f of b.files) {
      const p = f && safePath(f.p), ct = p && TYPES[extOf(p)];
      if (!p || !ct || !Number.isInteger(f.s) || f.s < 0 || f.s > LIMITS.MAX_FILE) return json({ error: "Invalid file entry: " + (f && f.p) }, 400);
      if (seen.has(p.toLowerCase())) return json({ error: "Duplicate file name: " + p }, 400);
      seen.add(p.toLowerCase());
      total += f.s;
      files[p] = { ct, s: f.s };
    }
    if (total > LIMITS.MAX_TOTAL) return json({ error: "Extracted size is too large (max 60 MB)." }, 400);
    const entry = safePath(b.entry);
    if (!entry || !files[entry] || !/^(html?)$/.test(extOf(entry))) return json({ error: "Entry HTML file is missing from the upload." }, 400);
    const paths = Object.keys(files);
    for (let i = 0; i < paths.length; i += 20) {
      const chunk = paths.slice(i, i + 20);
      const metas = await Promise.all(chunk.map((p) => store.getMetadata(`zf/${b.id}/${b.v}/${p}`)));
      for (let j = 0; j < chunk.length; j++) {
        const md = metas[j] && metas[j].metadata;
        if (!md || md.size !== files[chunk[j]].s) return json({ error: "A file did not upload completely: " + chunk[j] }, 400);
      }
    }
    // Optional: which HTML files / folders are the tool's admin panel (hidden from the public address).
    let admin = null;
    if (b.admin && typeof b.admin === "object") {
      const paths = (Array.isArray(b.admin.paths) ? b.admin.paths : []).slice(0, 50).map((x) => safePath(x)).filter((x) => x && files[x] && /^html?$/.test(extOf(x)));
      const dirs = (Array.isArray(b.admin.dirs) ? b.admin.dirs : []).slice(0, 10)
        .filter((x) => typeof x === "string" && x.endsWith("/") && safePath(x.slice(0, -1)));
      if (paths.includes(entry)) return json({ error: "The public entry page cannot also be the admin page." }, 400);
      if (paths.length || dirs.length) admin = { paths, dirs };
    }
    const manifest = { at: Date.now(), entry, name: String(b.name || "").slice(0, 200), files };
    if (admin) manifest.admin = admin;
    await store.setJSON(`zm/${b.id}/${b.v}`, manifest);
    return json({ ok: true });
  }

  if (a === "ticket") {
    const b = await readJson(req);
    if (!b || !okId(b.id) || !okVer(b.v)) return json({ error: "bad request" }, 400);
    if (!(await getManifest(store, b.id, b.v))) return json({ error: "Tool not found." }, 404);
    // tidy up expired tickets (cheap: the list is tiny)
    try {
      const { blobs } = await store.list({ prefix: "zt/" });
      for (const bl of blobs.slice(0, 60)) {
        const t = await store.get(bl.key, { type: "json" });
        if (!t || t.exp < Date.now()) await store.delete(bl.key);
      }
    } catch (e) {}
    const t = crypto.randomUUID().replace(/-/g, "");
    await store.setJSON(`zt/${t}`, { id: b.id, v: b.v, exp: Date.now() + TICKET_MS });
    return json({ ok: true, t, ttl: TICKET_MS });
  }

  if (a === "gc") {
    const b = await readJson(req);
    if (!b || !Array.isArray(b.live)) return json({ error: "bad request" }, 400);
    const live = new Set(b.live.filter((x) => x && okId(x.id) && okVer(x.v)).map((x) => x.id + "/" + x.v));
    const { blobs } = await store.list({ prefix: "zu/" });
    let removed = 0;
    for (const bl of blobs) {
      const [, id, v] = bl.key.split("/");
      if (!okId(id) || !okVer(v) || live.has(id + "/" + v)) continue;
      const mk = await store.get(bl.key, { type: "json" });
      if (mk && Date.now() - mk.at < GRACE_MS) continue;
      await deleteVersion(store, id, v);
      removed++;
      manCache.delete(id + "." + v);
    }
    return json({ ok: true, removed });
  }

  return json({ error: "unknown action" }, 400);
};

export const config = { path: ["/api/tool-zip", "/_tool/*"] };
