import { json, requireAuth, unauthorized } from "../../_shared.js";

export async function onRequestGet({ request, env, params }) {
  if (!requireAuth(request, env)) return unauthorized();
  return json({ error: "online uploads require R2 storage" }, { status: 501 });
}
