import { json, requireAuth, unauthorized } from "../../_shared.js";

const foodId = (params) => {
  const value = params.id;
  const raw = Array.isArray(value) ? value.join("/") : value || "";
  return decodeURIComponent(raw);
};

export async function onRequestDelete({ request, env, params }) {
  if (!requireAuth(request, env)) return unauthorized();

  const id = foodId(params);
  if (!id) return json({ error: "missing food id" }, { status: 400 });

  await env.DB.prepare("DELETE FROM foods WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
