import { json, requireAuth, unauthorized } from "../../_shared.js";

const albumId = (params) => {
  const value = params.id;
  const raw = Array.isArray(value) ? value.join("/") : value || "";
  return decodeURIComponent(raw);
};

export async function onRequestPut({ request, env, params }) {
  if (!requireAuth(request, env)) return unauthorized();

  const id = albumId(params);
  if (!id) return json({ error: "missing album id" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const date = String(body.date || "").slice(0, 20);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: "invalid date" }, { status: 400 });
  }

  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE albums SET date = ? WHERE id = ?").bind(date, id).run();
  await env.DB.prepare(
    "INSERT INTO album_dates (album_id, date, updated_at) VALUES (?, ?, ?) ON CONFLICT(album_id) DO UPDATE SET date = excluded.date, updated_at = excluded.updated_at",
  )
    .bind(id, date, now)
    .run();

  return json({ ok: true, date });
}
