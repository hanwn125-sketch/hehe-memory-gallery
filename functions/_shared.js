export const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });

export const requireAuth = (request, env) => {
  const expected = env.ACCESS_PASSWORD;
  const actual = request.headers.get("X-Site-Password") || "";
  return Boolean(expected && actual && actual === expected);
};

export const unauthorized = () => json({ error: "unauthorized" }, { status: 401 });

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
  })),
});
