import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import { fetchConnectGroups, geocode } from "../shared/pco.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// .env lives in the project root, one level up from /server
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const { PCO_APP_ID, PCO_SECRET } = process.env;
const PORT = process.env.PORT || 4000;

if (!PCO_APP_ID || !PCO_SECRET) {
  console.error("Missing PCO_APP_ID / PCO_SECRET in .env");
  process.exit(1);
}

const app = express();
app.use(cors());

// --- simple in-memory cache (5 min) ---
let cache = { data: null, ts: 0 };
const CACHE_MS = 5 * 60 * 1000;

app.get("/api/groups", async (req, res) => {
  try {
    const fresh = Date.now() - cache.ts < CACHE_MS;
    if (!cache.data || !fresh) {
      cache = { data: await fetchConnectGroups(PCO_APP_ID, PCO_SECRET), ts: Date.now() };
    }
    res.json({ groups: cache.data, count: cache.data.length });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Failed to load groups from Planning Center" });
  }
});

app.get("/api/geocode", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.status(400).json({ error: "Missing q" });
  try {
    const hit = await geocode(q);
    if (!hit) return res.status(404).json({ error: "Address not found" });
    res.json(hit);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Geocoding failed" });
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
