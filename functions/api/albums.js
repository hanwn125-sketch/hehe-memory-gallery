import { albumFromRows, json, requireAuth, unauthorized } from "../_shared.js";

export async function onRequestGet({ request, env }) {
  if (!requireAuth(request, env)) return unauthorized();

  const { results: albums } = await env.DB.prepare("SELECT * FROM albums ORDER BY date DESC, created_at DESC").all();
  if (!albums.length) return json([]);

  const { results: photos } = await env.DB.prepare("SELECT * FROM photos ORDER BY created_at ASC").all();
  return json(albums.map((album) => albumFromRows(album, photos.filter((photo) => photo.album_id === album.id))));
}

export async function onRequestPost({ request, env }) {
  if (!requireAuth(request, env)) return unauthorized();

  const form = await request.formData();
  const requestedAlbumId = String(form.get("albumId") || "").slice(0, 120);
  const title = String(form.get("title") || "她的新合集").slice(0, 80);
  const date = String(form.get("date") || new Date().toISOString().slice(0, 10));
  const files = form.getAll("files").filter((file) => file && file.size && file.type?.startsWith("image/"));

  if (!files.length) return json({ error: "missing images" }, { status: 400 });

  const albumId = requestedAlbumId || crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO albums (id, title, date, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, date = excluded.date",
  )
    .bind(albumId, title, date, now)
    .run();

  const rows = [];
  const existing = await env.DB.prepare("SELECT size, mime FROM photos WHERE album_id = ?").bind(albumId).all();
  const existingSignatures = new Set(existing.results.map((photo) => `${photo.size}:${photo.mime}`));

  for (const file of files.slice(0, 80)) {
    if (file.size > 24 * 1024 * 1024) continue;
    const signature = `${file.size}:${file.type}`;
    if (existingSignatures.has(signature)) continue;
    existingSignatures.add(signature);

    const photoId = crypto.randomUUID();
    const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
    const key = `photo:${albumId}:${photoId}.${extension}`;
    await env.UPLOADS.put(key, await file.arrayBuffer(), {
      metadata: { albumId, photoId, contentType: file.type },
    });
    await env.DB.prepare("INSERT INTO photos (id, album_id, r2_key, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(photoId, albumId, key, file.type, file.size, now)
      .run();
    rows.push({ id: photoId, album_id: albumId, r2_key: key, mime: file.type, size: file.size, created_at: now });
  }

  const { results: photos } = await env.DB.prepare("SELECT * FROM photos WHERE album_id = ? ORDER BY created_at ASC").bind(albumId).all();
  if (!photos.length) return json({ error: "images are too large" }, { status: 400 });
  return json(albumFromRows({ id: albumId, title, date, created_at: now }, photos));
}

export async function onRequestDelete({ request, env }) {
  if (!requireAuth(request, env)) return unauthorized();
  return json({ error: "album id required" }, { status: 400 });
}
