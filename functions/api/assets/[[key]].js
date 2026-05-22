import { json, requireAuth, unauthorized } from "../../_shared.js";

const assetKey = (params) => {
  const value = params.key;
  const raw = Array.isArray(value) ? value.join("/") : value || "";
  return decodeURIComponent(raw);
};

export async function onRequestGet({ request, env, params }) {
  if (!requireAuth(request, env)) return unauthorized();

  const key = assetKey(params);
  if (!key) return json({ error: "missing asset key" }, { status: 400 });

  const photo = await env.DB.prepare("SELECT mime FROM photos WHERE r2_key = ?").bind(key).first();
  const bytes = await env.UPLOADS.get(key, "arrayBuffer");
  if (!bytes) return json({ error: "not found" }, { status: 404 });

  return new Response(bytes, {
    headers: {
      "Content-Type": photo?.mime || "application/octet-stream",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
