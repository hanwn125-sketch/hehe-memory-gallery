import { requireAuth, unauthorized } from "../../_shared.js";

const assetKey = (params) => {
  const value = params.key;
  return Array.isArray(value) ? value.join("/") : value || "";
};

export async function onRequestGet({ request, env, params }) {
  if (!requireAuth(request, env)) return unauthorized();

  const key = assetKey(params);
  if (!key) return new Response("Missing asset key", { status: 400 });

  const object = await env.PHOTOS.get(key);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  return new Response(object.body, { headers });
}
