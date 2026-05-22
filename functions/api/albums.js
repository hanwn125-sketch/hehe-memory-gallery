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
  const title = String(form.get("title") || "她的新合集").slice(0, 80);
  const date = String(form.get("date") || new Date().toISOString().slice(0, 10));
  const files = form.getAll("files").filter((file) => file && file.size && file.type?.startsWith("image/"));

  if (!files.length) return json({ error: "missing images" }, { status: 400 });

  const albumId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO albums (id, title, date, created_at) VALUES (?, ?, ?, ?)").bind(albumId, title, date, now).run();

  const rows = [];
  for (const file of files.slice(0, 80)) {
    const photoId = crypto.randomUUID();
    const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
    const key = `${albumId}/${photoId}.${extension}`;
    await env.PHOTOS.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
      customMetadata: { albumId, photoId },
    });
    await env.DB.prepare("INSERT INTO photos (id, album_id, r2_key, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(photoId, albumId, key, file.type, file.size, now)
      .run();
    rows.push({ id: photoId, album_id: albumId, r2_key: key, mime: file.type, size: file.size, created_at: now });
  }

  return json(albumFromRows({ id: albumId, title, date, created_at: now }, rows));
}
