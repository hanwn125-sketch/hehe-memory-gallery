import { json, requireAuth, unauthorized } from "../../_shared.js";

const albumId = (params) => {
  const value = params.id;
  const raw = Array.isArray(value) ? value.join("/") : value || "";
  return decodeURIComponent(raw);
};

export async function onRequestDelete({ request, env, params }) {
  if (!requireAuth(request, env)) return unauthorized();

  const id = albumId(params);
  if (!id) return json({ error: "missing album id" }, { status: 400 });

  const { results: photos } = await env.DB.prepare("SELECT r2_key FROM photos WHERE album_id = ?").bind(id).all();
  for (const photo of photos) {
    await env.UPLOADS.delete(photo.r2_key);
  }

  await env.DB.prepare("DELETE FROM photos WHERE album_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM albums WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
