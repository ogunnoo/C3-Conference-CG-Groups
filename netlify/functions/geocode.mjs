import { geocode } from "../../shared/pco.mjs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export default async (req) => {
  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  if (!q) return json({ error: "Missing q" }, 400);
  try {
    const hit = await geocode(q);
    if (!hit) return json({ error: "Address not found" }, 404);
    return json(hit);
  } catch (err) {
    console.error(err);
    return json({ error: "Geocoding failed" }, 502);
  }
};
