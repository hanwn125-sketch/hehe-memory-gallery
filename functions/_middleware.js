const ALLOWED_ORIGINS = new Set([
  "https://hanwn125-sketch.github.io",
  "https://hehe-memory-gallery.pages.dev",
]);

const corsHeaders = (request) => {
  const origin = request.headers.get("Origin") || "";
  if (!ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Site-Password",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
};

export async function onRequest({ request, next }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  const response = await next();
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders(request)).forEach(([name, value]) => headers.set(name, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
