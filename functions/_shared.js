const ALLOWED_ORIGINS = new Set([
  "https://hanwn125-sketch.github.io",
  "https://hehe-memory-gallery.pages.dev",
]);

export const corsHeaders = (request) => {
  const origin = request?.headers.get("Origin") || "";
  if (!ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Site-Password",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
};

export const json = (data, init = {}, request) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request),
      ...(init.headers || {}),
    },
  });

export const preflight = (request) => new Response(null, { status: 204, headers: corsHeaders(request) });

export const requireAuth = (request, env) => {
  const expected = String(env.ACCESS_PASSWORD || "").trim();
  const actual = String(request.headers.get("X-Site-Password") || "").trim();
  return Boolean(expected && actual && actual === expected);
};

export const unauthorized = (request) => json({ error: "unauthorized" }, { status: 401 }, request);

export const albumFromRows = (album, photos) => ({
  id: album.id,
  remote: true,
  sourceFolder: "cloudflare",
  title: album.title,
  date: album.date,
  category: "她的上传",
  mood: "线上合集",
  place: "",
  cover: photos[0]?.r2_key || "",
  count: photos.length,
  photos: photos.length,
  videos: 0,
  items: photos.map((photo, index) => ({
    id: photo.id,
    remote: true,
    type: photo.mime?.startsWith("video/") ? "video" : "image",
    title: album.title,
    src: `/api/assets/${encodeURIComponent(photo.r2_key)}`,
    apiSrc: `/api/assets/${encodeURIComponent(photo.r2_key)}`,
    mime: photo.mime || "image/jpeg",
    originalPath: "",
    date: album.date,
    year: album.date?.slice(0, 4) || "",
    bytes: photo.size || 0,
    storageKey: photo.r2_key,
    remoteAlbumId: album.id,
    remoteDeletable: true,
  })),
});
