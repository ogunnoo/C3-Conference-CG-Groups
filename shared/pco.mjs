// Shared Planning Center + geocoding logic.
// Imported by the local Express server (server/index.js) and the Netlify
// serverless functions (netlify/functions/*) so there's one source of truth.

const PCO_BASE = "https://api.planningcenteronline.com/groups/v2";
const CONNECT_GROUPS_TYPE_ID = "448862";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// Pull the weekday out of a schedule string like "Meets weekly on Thursdays from 7-9pm".
function parseDay(schedule = "") {
  const s = schedule.toLowerCase();
  return DAYS.find((d) => s.includes(d.toLowerCase())) || null;
}

// Fetch all listed Connect Groups (paginated) with their locations included.
export async function fetchConnectGroups(appId, secret) {
  if (!appId || !secret) {
    throw new Error("Missing PCO_APP_ID / PCO_SECRET");
  }
  const authHeader =
    "Basic " + Buffer.from(`${appId}:${secret}`).toString("base64");

  const pcoFetch = async (url) => {
    const res = await fetch(url, { headers: { Authorization: authHeader } });
    if (!res.ok) throw new Error(`PCO ${res.status}: ${await res.text()}`);
    return res.json();
  };

  const groups = [];
  const locations = new Map();
  let offset = 0;

  while (true) {
    const url =
      `${PCO_BASE}/group_types/${CONNECT_GROUPS_TYPE_ID}/groups` +
      `?include=location&per_page=100&offset=${offset}`;
    const json = await pcoFetch(url);

    for (const inc of json.included || []) {
      if (inc.type === "Location") locations.set(inc.id, inc.attributes);
    }

    for (const g of json.data) {
      const a = g.attributes;
      if (!a.listed || !a.public_church_center_web_url) continue;

      const locId = g.relationships?.location?.data?.id;
      const loc = locId ? locations.get(locId) : null;
      if (!loc || loc.latitude == null || loc.longitude == null) continue;

      groups.push({
        id: g.id,
        name: a.name,
        description: a.description_as_plain_text || a.description || "",
        schedule: a.schedule || "",
        day: parseDay(a.schedule || ""),
        image: a.header_image?.medium || a.header_image?.original || null,
        contactEmail: a.contact_email || null,
        membersCount: a.memberships_count ?? null,
        lat: loc.latitude,
        lng: loc.longitude,
        locationName: loc.name || "",
        signupUrl: a.public_church_center_web_url,
      });
    }

    if (!json.links?.next) break;
    offset += 100;
  }

  return groups;
}

// Geocode an address -> coordinates via OpenStreetMap Nominatim.
// Returns { lat, lng, label } or null if no match. Throws on network failure.
export async function geocode(q) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1" +
    "&countrycodes=ca&q=" +
    encodeURIComponent(q);
  const r = await fetch(url, {
    headers: {
      "User-Agent": "ConnectGroupsMap/1.0 (church connect groups locator)",
      "Accept-Language": "en",
    },
  });
  if (!r.ok) throw new Error(`Nominatim ${r.status}`);
  const hits = await r.json();
  if (!hits.length) return null;
  const h = hits[0];
  return { lat: parseFloat(h.lat), lng: parseFloat(h.lon), label: h.display_name };
}
