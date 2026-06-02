import { fetchConnectGroups } from "../../shared/pco.mjs";

// Best-effort cache: persists across warm invocations of the same instance.
let cache = { data: null, ts: 0 };
const CACHE_MS = 5 * 60 * 1000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export default async () => {
  try {
    const fresh = Date.now() - cache.ts < CACHE_MS;
    if (!cache.data || !fresh) {
      cache = {
        data: await fetchConnectGroups(
          process.env.PCO_APP_ID,
          process.env.PCO_SECRET
        ),
        ts: Date.now(),
      };
    }
    return json({ groups: cache.data, count: cache.data.length });
  } catch (err) {
    console.error(err);
    return json({ error: "Failed to load groups from Planning Center" }, 502);
  }
};
