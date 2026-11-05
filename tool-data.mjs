import { ensureSeed } from "../lib/seed.mjs";
import { getStore } from "@netlify/blobs";
import { json, authed } from "../lib/auth.mjs";

const okName = (t) => typeof t === "string" && /^[a-z0-9-]{1,60}$/.test(t);

export default async (req) => {
  await ensureSeed(); // restores a backup on a new site (once)
  const store = getStore({ name: "maskan", consistency: "strong" });

  if (req.method === "GET") {
    const tool = new URL(req.url).searchParams.get("tool");
    if (!okName(tool)) return json({ error: "bad tool" }, 400);
    const rec = await store.get("tool:" + tool, { type: "json" });
    return rec ? json(rec) : json({ error: "empty" }, 404);
  }

  if (req.method === "POST") {
    if (!(await authed(req, store))) return json({ error: "denied" }, 401);
    const text = await req.text();
    if (text.length > 1100000) return json({ error: "too large" }, 413);
    let body = {};
    try { body = JSON.parse(text); } catch (e) { return json({ error: "bad json" }, 400); }
    if (!okName(body.tool)) return json({ error: "bad tool" }, 400);
    if (body.data === undefined) return json({ error: "bad data" }, 400);
    const prev = await store.get("tool:" + body.tool, { type: "json" });
    if (prev) await store.setJSON("backup:tool:" + body.tool, prev); // one-step undo
    const savedAt = Date.now();
    await store.setJSON("tool:" + body.tool, { savedAt, data: body.data });
    return json({ ok: true, savedAt });
  }

  return json({ error: "method" }, 405);
};

export const config = { path: "/api/tool-data" };
