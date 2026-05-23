import { json, requireAuth, unauthorized } from "../_shared.js";

export async function onRequestGet({ request, env }) {
  if (!requireAuth(request, env)) return unauthorized();

  const [hiddenAlbums, hiddenPhotos, covers, dates] = await Promise.all([
    env.DB.prepare("SELECT album_id FROM hidden_albums").all(),
    env.DB.prepare("SELECT item_id FROM hidden_photos").all(),
    env.DB.prepare("SELECT album_id, item_id FROM album_covers").all(),
    env.DB.prepare("SELECT album_id, date FROM album_dates").all(),
  ]);

  return json({
    hiddenAlbums: hiddenAlbums.results.map((row) => row.album_id),
    hiddenPhotos: hiddenPhotos.results.map((row) => row.item_id),
    covers: Object.fromEntries(covers.results.map((row) => [row.album_id, row.item_id])),
    dates: Object.fromEntries(dates.results.map((row) => [row.album_id, row.date])),
  });
}
