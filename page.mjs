import { ensureSeed } from "../lib/seed.mjs";
// Server-rendered <head> for every public page so search engines and AdSense reviewers
// see real titles, descriptions, canonical URLs, Open Graph and schema without running JS.
// Also serves /sitemap.xml, /robots.txt and /ads.txt from the live site data.
// No domain is hardcoded: every URL uses the address the request came in on.
import { getStore } from "@netlify/blobs";
import { vidParse } from "../lib/video.mjs";
import { readFile } from "node:fs/promises";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slug = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
// Sitemap <lastmod> and schema dates must be W3C format (YYYY-MM-DD). Admin dates are free text ("28 Oct 2026", "10/28/26"),
// so convert what can be understood and return "" for the rest (the tag is then simply left out instead of breaking the sitemap).
function isoDate(v) {
  const t = String(v ?? "").trim();
  if (!t || /^\d{4}$/.test(t)) return "";
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(t);
  let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    const ms = Date.parse(t + (/\d{1,2}:\d{2}|GMT|UTC|Z$/i.test(t) ? "" : " 12:00 UTC"));
    if (isNaN(ms)) return "";
    const x = new Date(ms); y = x.getUTCFullYear(); mo = x.getUTCMonth() + 1; d = x.getUTCDate();
  }
  const chk = new Date(Date.UTC(y, mo - 1, d));
  if (y < 1990 || y > 2100 || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return "";
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
// Site logo (Admin > Site customizer). Default is the bundled /logo.png; an empty value means "no logo image".
const LOGO_RE = /^(\/[A-Za-z0-9._~\/-]+|https:\/\/[^\s"'<>]+)$/;
const logoOf = (d, origin) => {
  const v = d && d.logoImg !== undefined ? d.logoImg : "/logo.png";
  return typeof v === "string" && LOGO_RE.test(v) ? (v.startsWith("/") ? origin + v : v) : "";
};
// Pages can be "link" pages that point to another website. Only http(s) addresses are followed.
const extUrl = (v) => { try { const u = new URL(String(v || "").trim()); return /^https?:$/.test(u.protocol) ? u.href : ""; } catch { return ""; } };
const PUB_RE = /^ca-pub-(\d{10,20})$/;

// One strong read per page view. The same record is used for the <head> tags AND embedded in the page,
// so the browser no longer needs a second round trip to /api/site-data before it can show the page.
async function loadSite() {
  try { const s = await getStore({ name: "maskan", consistency: "strong" }).get("site", { type: "json" }); return s && s.data ? s : null; }
  catch { return null; }
}
const EMBED_MAX = 1800000; // larger sites skip embedding (Netlify Functions cap responses at ~6 MB); the page then fetches /api/site-data as before
// Speed settings saved from Admin > Site optimisation & speed (all optional; defaults keep the old behaviour).
const perfOf = (d) => Object.assign({ heroPreload: true, preconnect: true, edgeCache: 60, deferAds: false, embedData: true, sysFonts: false }, (d && d.perf) || {});
const embedTag = (rec) => {
  if (!rec) return "";
  if (perfOf(rec.data).embedData === false) return "";
  let j = "";
  try { j = JSON.stringify({ data: rec.data, savedAt: rec.savedAt || 0 }); } catch { return ""; }
  if (j.length > EMBED_MAX) return "";
  j = j.replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `<script id="site-boot" type="application/json">${j}</script>`;
};
// The page shell never changes between deploys, so keep it in memory instead of re-reading the 160 KB file on every request.
let SHELL = null;
async function getShell(origin) {
  if (SHELL) return SHELL;
  let html = null;
  // The page shell lives in public/app.html (only the "public" folder is published; netlify/ is not).
  for (const f of [new URL("../../public/app.html", import.meta.url), "public/app.html", "/var/task/public/app.html"]) {
    try { html = await readFile(f, "utf8"); break; } catch {}
  }
  if (html == null) {
    const r = await fetch(new URL("/app.html", origin));
    if (!r.ok) return null;
    html = await r.text();
  }
  return (SHELL = html);
}

// Same rules as the admin page (app.html), so a hero picture page has the same address in both places.
function slideSlugs(slides) {
  const seen = new Set();
  return (slides || []).map((x) => {
    let b = slug(x.slug).replace(/-+$/, "") || slug(x.t).replace(/-+$/, "") || "banner";
    b = b.slice(0, 60).replace(/-+$/, "") || "banner";
    let n = b, k = 2;
    while (seen.has(n)) n = b + "-" + k++;
    seen.add(n);
    return n;
  });
}
// YouTube link -> video id (null when it is not a single YouTube video).
function ytId(u) {
  u = String(u || "").trim();
  if (/^[\w-]{11}$/.test(u)) return u;
  let x;
  try { x = new URL(/^https?:\/\//i.test(u) ? u : "https://" + u); } catch { return null; }
  const h = x.hostname.replace(/^(www|m|music)\./, "");
  let id = "";
  if (h === "youtu.be") id = x.pathname.slice(1).split("/")[0];
  else if (/^youtube(-nocookie)?\.com$/.test(h)) {
    if (x.pathname === "/watch") id = x.searchParams.get("v") || "";
    else { const m = /^\/(embed|shorts|live|v)\/([\w-]{11})/.exec(x.pathname); if (m) id = m[2]; }
  }
  return /^[\w-]{11}$/.test(id) ? id : null;
}
const absImg = (origin, u) => (/^https?:/.test(u || "") ? u : /^\/media\//.test(u || "") ? origin + u : "");

function routesOf(d) {
  const out = [{ p: "/", kind: "home" }, { p: "/newsflash", kind: "news" }, { p: "/doc", kind: "docs" }, { p: "/videos", kind: "videos" }, { p: "/gallery", kind: "gallery" }];
  if (!d) return out;
  (d.vids || []).filter((v) => v && v.pub && slug(v.slug) && vidParse(v.url)).forEach((v) => out.push({ p: "/videos/" + slug(v.slug), kind: "vid", item: v }));
  const ss = slideSlugs(d.slides);
  (d.slides || []).forEach((x, i) => { if ((x.lk || "page") === "page") out.push({ p: "/featured/" + ss[i], kind: "feat", item: x }); });
  (d.pages || []).filter((p) => p.pub).forEach((p) => out.push({ p: "/" + p.slug, kind: "page", item: p }));
  (d.arts || []).filter((a) => a.pub).forEach((a) => out.push({ p: "/newsflash/" + a.slug, kind: "art", item: a }));
  (d.boxes || []).forEach((b) => out.push({ p: "/tools/" + slug(b.title), kind: "tool", item: b }));
  return out;
}

function headFor(r, d, origin, path) {
  const site = (d && d.title) || "Maskan Estates";
  const seo = (d && d.seo) || {};
  const tpl = (t) => (seo.tpl || "%page% | %site%").replace("%page%", t).replace("%site%", site);
  const baseDesc = seo.desc || "Property listings, calculators and Newsflash updates for plot owners and buyers in Pakistan.";
  const logo = logoOf(d, origin);
  let title = site, desc = baseDesc, type = "website", img = seo.og || "", ld = [];
  const url = origin + path;
  if (r) {
    if (r.kind === "news") { title = tpl("Newsflash"); desc = `Latest property notices and updates summarised by ${site}.`; }
    if (r.kind === "docs") { title = tpl("Documents"); desc = `Property checklists and document templates from ${site}.`; }
    if (r.kind === "videos") { title = tpl("Videos"); desc = `Watch ${site} videos, played from our official channels.`; }
    if (r.kind === "gallery") {
      title = tpl("Gallery"); desc = `Photo gallery from ${site}.`;
      const pics = ((d && d.gal) || []).filter((g) => g && g.pub && g.img).map((g) => ({ u: absImg(origin, g.img), g })).filter((x) => x.u).slice(0, 30);
      if (pics.length) {
        img = pics[0].u;
        ld.push({ "@context": "https://schema.org", "@type": "ImageGallery", name: title, url, image: pics.map((x) => ({ "@type": "ImageObject", contentUrl: x.u, ...(x.g.cap || x.g.t ? { caption: String(x.g.cap || x.g.t) } : {}) })) });
      }
    }
    if (r.kind === "feat") {
      const x = r.item; title = tpl(x.t || "Featured"); desc = plainText(x.s || x.body || "").replace(/\s+/g, " ").slice(0, 155) || baseDesc;
      img = absImg(origin, x.img) || img;
    }
    if (r.kind === "vid") {
      const v = r.item, y = vidParse(v.url), thumb = absImg(origin, v.thumb) || (y && y.thumb) || "";
      title = tpl(v.title || "Video"); desc = String(v.desc || "").replace(/\s+/g, " ").slice(0, 155) || baseDesc; type = "video.other"; if (thumb) img = thumb;
      if (thumb && /^\d{4}-\d{2}-\d{2}/.test(v.date || "")) {
        const vo = { "@context": "https://schema.org", "@type": "VideoObject", name: v.title, description: desc, thumbnailUrl: thumb, uploadDate: v.date, inLanguage: "en-PK" };
        if (y && /^(youtube|vimeo|dailymotion)$/.test(y.p)) vo.embedUrl = y.embed;
        if (y && y.p === "file") vo.contentUrl = y.src;
        ld.push(vo);
      }
      ld.push({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [["Home", "/"], ["Videos", "/videos"], [v.title, path]].map(([n, p], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: origin + p })) });
    }
    if (r.kind === "page") { title = tpl(r.item.title); desc = plainText(r.item.body || "").replace(/\s+/g, " ").replace(/^\s*Last updated:\s*(\[date\]|\d{1,2} [A-Za-z]+ \d{4})\s*/i, "").slice(0, 155) || baseDesc; }
    if (r.kind === "tool") { title = tpl(r.item.title); desc = r.item.dis || baseDesc; }
    if (r.kind === "art") {
      const a = r.item; title = tpl(a.title); desc = a.sum || baseDesc; type = "article";
      if (absImg(origin, a.img)) img = absImg(origin, a.img);
      const art = { "@context": "https://schema.org", "@type": "NewsArticle", headline: a.title, description: a.sum, mainEntityOfPage: url, inLanguage: "en-PK", publisher: { "@type": "Organization", name: site } };
      if (isoDate(a.date)) art.datePublished = isoDate(a.date);
      const pics = [a.img, ...(a.imgs || [])].map((u) => absImg(origin, u)).filter(Boolean);
      if (pics.length) art.image = pics;
      if (extUrl(a.src)) art.isBasedOn = extUrl(a.src);
      ld.push(art, { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [["Home", "/"], ["Newsflash", "/newsflash"], [a.title, path]].map(([n, p], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: origin + p })) });
    }
    if (r.kind === "home") ld.push({ "@context": "https://schema.org", "@type": "WebSite", name: site, url: origin + "/" }, { "@context": "https://schema.org", "@type": "Organization", name: site, url: origin + "/", ...(logo ? { logo } : {}) });
  }
  const logoAsImg = !img && !!logo;
  if (logoAsImg) img = logo;
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<meta name="robots" content="${r ? "index,follow,max-image-preview:large" : "noindex"}">`,
    r ? `<link rel="canonical" href="${esc(url)}">` : "",
    `<meta property="og:site_name" content="${esc(site)}">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    img ? `<meta property="og:image" content="${esc(img)}">` : "",
    `<meta name="twitter:card" content="${img && !logoAsImg ? "summary_large_image" : "summary"}">`,
    logo ? `<link rel="icon" href="${esc(logo)}">` : "",
    logo ? `<link rel="apple-touch-icon" href="${esc(logo)}">` : "",
    ...ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`),
  ];
  const pf = perfOf(d), pub = PUB_RE.exec(seo.ads || "");
  // Hero picture is the biggest thing on the home page: tell the browser to fetch it first.
  const s0 = d && Array.isArray(d.slides) && d.slides[0];
  if (pf.heroPreload && r && r.kind === "home" && s0 && typeof s0.img === "string" && /^(\/media\/|https:\/\/)/.test(s0.img)) tags.push(`<link rel="preload" as="image" href="${esc(s0.img)}" fetchpriority="high">`);
  if (pub) {
    tags.push(`<meta name="google-adsense-account" content="ca-pub-${pub[1]}">`);
    const src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-${pub[1]}`;
    if (pf.deferAds) tags.push(`<script id="adsbygoogle-js">(function(){var l=0;function go(){if(l)return;l=1;var s=document.createElement("script");s.async=1;s.crossOrigin="anonymous";s.src=${JSON.stringify(src)};document.head.appendChild(s)}["scroll","click","touchstart","keydown","mousemove"].forEach(function(e){addEventListener(e,go,{once:true,passive:true})});setTimeout(go,6000)})()</script>`);
    else tags.push(...(pf.preconnect ? [`<link rel="preconnect" href="https://pagead2.googlesyndication.com" crossorigin>`] : []), `<script async id="adsbygoogle-js" src="${src}" crossorigin="anonymous"></script>`);
  }
  // Admin > Website SEO > "Extra <head> code" (Google Search Console tag, analytics). Only meta/link/script tags are passed through,
  // so the verification tag is in the real HTML that Google downloads (before, it only appeared as text in the admin preview).
  if (seo.head && r) {
    const extra = String(seo.head).match(/<meta\b[^>]*>|<link\b[^>]*>|<script\b[\s\S]*?<\/script>/gi);
    if (extra) tags.push(...extra);
  }
  return tags.filter(Boolean).join("\n");
}

const plainText = (s) => { s = String(s || ""); if (!/^\s*<(p|h[1-6]|ul|ol|div|blockquote|table|hr)[\s>\/]/i.test(s)) return s; return s.replace(/<\/(p|h[1-6]|li|tr|div|blockquote)>|<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'"); };
const text = (body, type, status = 200) => new Response(body, { status, headers: { "Content-Type": type + "; charset=utf-8", "Cache-Control": "public, max-age=300" } });

export default async (req) => {
  await ensureSeed(); // restores a backup on a new site (once)
  const u = new URL(req.url), origin = u.origin;
  const path = decodeURIComponent(u.pathname).replace(/\/+$/, "") || "/";
  const rec = await loadSite();
  const d = rec ? rec.data : null;

  if (path.toLowerCase() === "/robots.txt")
    return text(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /doc-editor.html\nDisallow: /tools/*/admin\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`, "text/plain");
  if (path.toLowerCase() === "/sitemap.xml") {
    const urls = routesOf(d).filter((r) => !(r.kind === "page" && r.item.kind === "link")).map((r) => `  <url><loc>${esc(origin + r.p)}</loc>${isoDate(r.item && r.item.date) ? `<lastmod>${isoDate(r.item.date)}</lastmod>` : ""}</url>`);
    return text(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`, "application/xml");
  }
  if (path.toLowerCase() === "/ads.txt") {
    const pub = PUB_RE.exec((d && d.seo && d.seo.ads) || "");
    return pub ? text(`google.com, pub-${pub[1]}, DIRECT, f08c47fec0942fa0\n`, "text/plain") : text("# AdSense publisher ID not set yet (Admin > Website SEO & AdSense)\n", "text/plain", 404);
  }

  let html = await getShell(origin);
  if (html == null) return text("Site shell missing", "text/plain", 500);

  if (path === "/admin") {
    html = html.replace(/<title>[\s\S]*?<\/title>/, "<title>Admin</title>").replace("<!--SEO-HEAD-->", () => '<meta name="robots" content="noindex,nofollow">').replace("<!--SITE-DATA-->", () => "");
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Frame-Options": "DENY" } });
  }
  const all = routesOf(d);
  let r = all.find((x) => x.p === path);
  // /tools/<tool>/<tab> (e.g. /tools/set-format/admin) is a real address inside a tool: serve it with 200.
  // The /admin tab is private: never indexed, never cached, and the tool shows it only after the site admin signs in.
  const tm = !r && /^\/tools\/([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(path);
  if (tm) {
    const parent = all.find((x) => x.kind === "tool" && x.p === "/tools/" + tm[1]);
    if (parent) {
      if (tm[2] === "admin") {
        html = html.replace(/<title>[\s\S]*?<\/title>\s*<meta name="description"[^>]*>/, "").replace("<!--SEO-HEAD-->", () => '<title>Admin</title><meta name="robots" content="noindex,nofollow">').replace("<!--SITE-DATA-->", () => embedTag(rec));
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Frame-Options": "DENY" } });
      }
      r = parent;
    }
  }
  // Before the first publish there is no stored data yet; the app's built-in sample pages still render, so don't 404 them.
  if (!r && !d && /^\/[a-z0-9/-]*$/.test(path)) r = { p: path, kind: "home" };
  if (r && r.kind === "page" && r.item.kind === "link") {
    const to = extUrl(r.item.url);
    if (to) return new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "public, max-age=300" } });
  }
  html = html.replace(/<title>[\s\S]*?<\/title>\s*<meta name="description"[^>]*>/, "").replace("<!--SEO-HEAD-->", () => headFor(r, d, origin, path)).replace("<!--SITE-DATA-->", () => embedTag(rec));
  const pf = perfOf(d);
  // "Use system fonts": drop the Google Fonts links (the CSS already falls back to system-ui).
  if (pf.sysFonts) html = html.replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>/g, "").replace(/<noscript>\s*<\/noscript>/g, "");
  // Public pages may only be framed by this same site (stops clickjacking); no plug-in objects; links cannot be redirected by an injected <base>.
  const h = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=0, must-revalidate", "X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" };
  // Netlify's CDN keeps the finished page for a short time, so most visitors skip the function and the storage read.
  const ec = Math.max(0, Math.min(3600, Number(pf.edgeCache) || 0));
  if (r && ec) h["Netlify-CDN-Cache-Control"] = `public, s-maxage=${ec}, stale-while-revalidate=86400, durable`;
  return new Response(html, { status: r ? 200 : 404, headers: h });
};

export const config = {
  path: "/*",
  excludedPath: ["/api/*", "/_tool/*", "/media/*", "/.netlify/*", "/app.html", "/doc-editor.html"],
  preferStatic: true,
};
