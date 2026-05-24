import { json, requireAuth, unauthorized } from "../_shared.js";

const clean = (value, max = 160) => String(value || "").trim().slice(0, max);

export async function onRequestGet({ request, env }) {
  if (!requireAuth(request, env)) return unauthorized();

  const { results } = await env.DB.prepare("SELECT * FROM foods ORDER BY created_at DESC").all();
  return json(results);
}

export async function onRequestPost({ request, env }) {
  if (!requireAuth(request, env)) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const shop = clean(body.shop, 80);
  if (!shop) return json({ error: "missing shop" }, { status: 400 });

  const food = {
    id: crypto.randomUUID(),
    shop,
    place: clean(body.place, 120),
    dishes: clean(body.dishes, 180),
    rating: Math.max(1, Math.min(5, Number(body.rating || 5))),
    note: clean(body.note, 400),
    created_at: new Date().toISOString(),
  };

  await env.DB.prepare(
    "INSERT INTO foods (id, shop, place, dishes, rating, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(food.id, food.shop, food.place, food.dishes, food.rating, food.note, food.created_at)
    .run();

  return json(food);
}
