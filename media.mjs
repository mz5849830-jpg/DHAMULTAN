import { ensureSeed } from "../lib/seed.mjs";
// Media library: photos AND videos. Files live in Netlify Blobs (store "maskan-media"), not inside the
// site record, so they don't count toward the 4.5 MB site-content limit.
//   GET  /media/<id>                 public: serves the file (videos support Range requests)
//   GET  /api/media                  admin: list
//   POST /api/media?a=upload         admin: raw image body, headers X-Name, X-Opt, Content-Type
//   POST /api/media?a=vstart         admin: JSON {name,size,type,opt}  -> starts a chunked video upload
//   POST /api/media?a=vchunk&id=&n=  admin: raw chunk body (3 MB each)
//   POST /api/media?a=vdone          admin: JSON {id}                  -> finishes the video upload
//   POST /api/media?a=alt|delete|flag  admin: JSON {id, ...}
import { getStore } from "@netlify/blobs";
import { randomBytes } from "node:crypto";
import { json, sessionOf, logEvent } from "../lib/auth.mjs";

const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "video/mp4": "mp4", "video/webm": "webm" };
const MAX = 4 * 1024 * 1024;              // one image
const CH = 3 * 1024 * 1024;               // video chunk size (Netlify Functions accept ~6 MB per request)
const VMAX = 60 * 1024 * 1024;            // one video
const okId = (s) => typeof s === "string" && /^[a-z0-9]{16}\.(jpg|png|webp|gif|avif|mp4|webm)$/.test(s);
const isVid = (id) => /\.(mp4|webm)$/.test(id);
// Check real file signatures so a renamed script can't be stored as an "image" or "video".
function sniff(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  const s = String.fromCharCode(...b.slice(0, 12));
  if (s.startsWith("RIFF") && s.slice(8, 12) === "WEBP") return "image/webp";
  if (s.slice(4, 12) === "ftypavif" || s.slice(4, 12) === "ftypavis") return "image/avif";
  if (s.slice(4, 8) === "ftyp") return "video/mp4"; // mp4 / m4v / mov (QuickTime) containers
  return "";
}
const headers = (type, extra = {}) => ({ "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", ...extra });

async function serveVideo(req, media, id) {
  const meta = await media.get("m/" + id, { type: "json" });
  if (!meta) return new Response("Not found", { status: 404 });
  const size = meta.size, rh = req.headers.get("range");
  let start = 0, end = Math.min(size - 1, CH - 1), partial = size > CH;
  if (rh) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(rh.trim());
    if (!m || (m[1] === "" && m[2] === "")) return new Response("Bad range", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    if (m[1] === "") { start = Math.max(0, size - Number(m[2])); end = size - 1; }
    else { start = Number(m[1]); end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
    if (start >= size || start > end) return new Response("Bad range", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    end = Math.min(end, start + CH - 1); // a response may be shorter than asked; the browser asks for the rest
    partial = true;
  }
  const len = end - start + 1;
  const h = headers(meta.type, { "Accept-Ranges": "bytes", "Content-Length": String(len) });
  if (partial) h["Content-Range"] = `bytes ${start}-${end}/${size}`;
  if (req.method === "HEAD") return new Response(null, { status: partial ? 206 : 200, headers: h });
  const out = new Uint8Array(len);
  for (let n = Math.floor(start / CH); n <= Math.floor(end / CH); n++) {
    const c = await media.get(`v/${id}/${n}`, { type: "arrayBuffer" });
    if (!c) return new Response("Missing data", { status: 500 });
    const cs = n * CH, from = Math.max(start, cs), to = Math.min(end, cs + c.byteLength - 1);
    out.set(new Uint8Array(c, from - cs, to - from + 1), from - start);
  }
  return new Response(out, { status: partial ? 206 : 200, headers: h });
}

async function dropFiles(media, id) {
  if (isVid(id)) {
    const { blobs } = await media.list({ prefix: `v/${id}/` });
    for (const b of blobs) await media.delete(b.key);
    await media.delete("m/" + id);
  } else await media.delete("f/" + id);
}

export default async (req) => {
  await ensureSeed(); // restores a backup on a new site (once)
  const u = new URL(req.url), media = getStore("maskan-media"), main = getStore("maskan");

  if (u.pathname.startsWith("/media/")) {
    const id = decodeURIComponent(u.pathname.slice(7));
    if (!okId(id)) return new Response("Not found", { status: 404 });
    if (isVid(id)) return serveVideo(req, media, id);
    const r = await media.getWithMetadata("f/" + id, { type: "arrayBuffer" });
    if (!r) return new Response("Not found", { status: 404 });
    return new Response(r.data, { headers: headers(r.metadata.type) });
  }

  const me = await sessionOf(req, main);
  if (!me) return json({ error: "denied" }, 401);
  const index = async () => (await media.get("index", { type: "json" })) || [];
  const addItem = async (item) => { const list = await index(); list.unshift(item); await media.setJSON("index", list.slice(0, 2000)); };
  const cleanName = (n, d) => { let raw = n || d; try { raw = decodeURIComponent(raw); } catch {} return raw.replace(/[^\w .()-]/g, "").slice(0, 80) || d; };

  if (req.method === "GET") return json({ ok: true, items: await index() });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const a = u.searchParams.get("a");

  if (a === "upload") {
    const buf = new Uint8Array(await req.arrayBuffer());
    if (!buf.length) return json({ error: "Empty file." }, 400);
    if (buf.length > MAX) return json({ error: "Image is larger than 4 MB. It is resized automatically in the admin; try a smaller picture." }, 413);
    const type = sniff(buf);
    if (!type || type.startsWith("video/")) return json({ error: "Only JPG, PNG, WebP, GIF or AVIF images are allowed here." }, 415);
    const id = randomBytes(8).toString("hex") + "." + TYPES[type];
    const name = cleanName(req.headers.get("x-name"), "image");
    await media.set("f/" + id, buf, { metadata: { type } });
    const item = { id, url: "/media/" + id, name, alt: name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "), size: buf.length, type, kind: "image", opt: req.headers.get("x-opt") === "1", at: Date.now() };
    await addItem(item);
    await logEvent(main, req, "media", "Uploaded photo " + name, me.user);
    return json({ ok: true, item });
  }

  if (a === "vstart") {
    let b = {}; try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    const size = Number(b.size), ext = TYPES[b.type];
    if (!ext || !/^(mp4|webm)$/.test(ext)) return json({ error: "Only MP4 or WebM video is allowed." }, 415);
    if (!(size > 0)) return json({ error: "Empty file." }, 400);
    if (size > VMAX) return json({ error: "Video is larger than " + VMAX / 1048576 + " MB. Use the Site optimisation tool or a shorter clip." }, 413);
    const id = randomBytes(8).toString("hex") + "." + ext;
    await media.setJSON("p/" + id, { name: cleanName(b.name, "video"), size, chunks: Math.ceil(size / CH), type: b.type, opt: !!b.opt, at: Date.now() });
    return json({ ok: true, id, chunk: CH });
  }
  if (a === "vchunk") {
    const id = u.searchParams.get("id"), n = Number(u.searchParams.get("n"));
    if (!okId(id) || !isVid(id) || !Number.isInteger(n) || n < 0) return json({ error: "bad id" }, 400);
    const p = await media.get("p/" + id, { type: "json" });
    if (!p) return json({ error: "Upload not found or expired. Start again." }, 404);
    if (n >= p.chunks) return json({ error: "bad chunk" }, 400);
    const buf = new Uint8Array(await req.arrayBuffer());
    const want = n < p.chunks - 1 ? CH : p.size - CH * (p.chunks - 1);
    if (buf.length !== want) return json({ error: "Chunk has the wrong size. Try again." }, 400);
    if (n === 0 && sniff(buf) !== p.type) return json({ error: "That file is not a real " + p.type.replace("video/", "").toUpperCase() + " video." }, 415);
    await media.set(`v/${id}/${n}`, buf);
    return json({ ok: true });
  }
  if (a === "vdone") {
    let b = {}; try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    if (!okId(b.id) || !isVid(b.id)) return json({ error: "bad id" }, 400);
    const p = await media.get("p/" + b.id, { type: "json" });
    if (!p) return json({ error: "Upload not found or expired. Start again." }, 404);
    const { blobs } = await media.list({ prefix: `v/${b.id}/` });
    if (blobs.length !== p.chunks) return json({ error: `Upload incomplete (${blobs.length} of ${p.chunks} parts). Try again.` }, 409);
    await media.setJSON("m/" + b.id, { size: p.size, type: p.type, chunks: p.chunks });
    await media.delete("p/" + b.id);
    const item = { id: b.id, url: "/media/" + b.id, name: p.name, alt: p.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "), size: p.size, type: p.type, kind: "video", opt: p.opt, at: Date.now() };
    await addItem(item);
    await logEvent(main, req, "media", "Uploaded video " + p.name, me.user);
    return json({ ok: true, item });
  }

  let body = {};
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  if (!okId(body.id)) return json({ error: "bad id" }, 400);
  const list = await index(), it = list.find((x) => x.id === body.id);
  if (!it) return json({ error: "File not found." }, 404);
  if (a === "alt") { it.alt = String(body.alt || "").slice(0, 200); await media.setJSON("index", list); return json({ ok: true }); }
  if (a === "flag") { it.opt = !!body.opt; await media.setJSON("index", list); return json({ ok: true }); }
  if (a === "delete") {
    await dropFiles(media, it.id);
    await media.setJSON("index", list.filter((x) => x.id !== it.id));
    await logEvent(main, req, "media", "Deleted " + (isVid(it.id) ? "video " : "photo ") + it.name, me.user);
    return json({ ok: true });
  }
  return json({ error: "unknown action" }, 400);
};

export const config = { path: ["/api/media", "/media/*"] };
