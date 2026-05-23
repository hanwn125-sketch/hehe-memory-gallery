import { json, requireAuth, unauthorized } from "../../../_shared.js";

const itemId = (params) => {
  const value = params.id;
  const raw = Array.isArray(value) ? value.join("/") : value || "";
  return decodeURIComponent(raw);
};

export async function onRequestPut({ request, env, params }) {
  if (!requireAuth(request, env)) return unauthorized();

  const id = itemId(params);
  if (!id) return json({ error: "missing item id" }, { status: 400 });

  await env.DB.prepare("INSERT OR IGNORE INTO hidden_photos (item_id, updated_at) VALUES (?, ?)").bind(id, new Date().toISOString()).run();
  return json({ ok: true });
}
