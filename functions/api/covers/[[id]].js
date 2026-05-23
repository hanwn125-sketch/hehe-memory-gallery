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
  const itemId = String(body.itemId || "").slice(0, 240);
  if (!itemId) return json({ error: "missing item id" }, { status: 400 });

  await env.DB.prepare(
    "INSERT INTO album_covers (album_id, item_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(album_id) DO UPDATE SET item_id = excluded.item_id, updated_at = excluded.updated_at",
  )
    .bind(id, itemId, new Date().toISOString())
    .run();
  return json({ ok: true });
}
