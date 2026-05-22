import { json, requireAuth, unauthorized } from "../../_shared.js";

const noteId = (params) => {
  const value = params.id;
  return Array.isArray(value) ? value.join("/") : value || "";
};

export async function onRequestGet({ request, env, params }) {
  if (!requireAuth(request, env)) return unauthorized();

  const id = noteId(params);
  if (id) {
    const row = await env.DB.prepare("SELECT note FROM notes WHERE item_id = ?").bind(id).first();
    return json({ note: row?.note || "" });
  }

  const { results } = await env.DB.prepare("SELECT item_id, note FROM notes").all();
  return json(Object.fromEntries(results.map((row) => [row.item_id, row.note])));
}

export async function onRequestPut({ request, env, params }) {
  if (!requireAuth(request, env)) return unauthorized();

  const id = noteId(params);
  if (!id) return json({ error: "missing note id" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const note = String(body.note || "").slice(0, 1200);

  if (!note.trim()) {
    await env.DB.prepare("DELETE FROM notes WHERE item_id = ?").bind(id).run();
    return json({ ok: true, deleted: true });
  }

  await env.DB.prepare(
    "INSERT INTO notes (item_id, note, updated_at) VALUES (?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at",
  )
    .bind(id, note, new Date().toISOString())
    .run();

  return json({ ok: true });
}
