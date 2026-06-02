import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";

const pinIcon = L.divIcon({
  className: "cg-pin",
  html: `
    <svg width="34" height="44" viewBox="0 0 34 44" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17 0C7.6 0 0 7.6 0 17c0 12 17 27 17 27s17-15 17-27C34 7.6 26.4 0 17 0z" fill="#dbf155"/>
      <circle cx="17" cy="17" r="6.5" fill="#221f20"/>
    </svg>`,
  iconSize: [34, 44],
  iconAnchor: [17, 44],
  popupAnchor: [0, -40],
});

const originIcon = L.divIcon({
  className: "cg-origin-icon",
  html: `<span class="cg-origin-pulse"></span><span class="cg-origin-dot"></span>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
};

// Haversine distance in kilometres.
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Fits the map to a set of [lat,lng] points. Debounced. Skips while a group is
// selected so the click-to-fly zoom isn't immediately overridden.
function FitToPoints({ points, suppressed }) {
  const map = useMap();
  const sig = points.map((p) => p.join(",")).join("|");
  useEffect(() => {
    if (suppressed || points.length === 0) return;
    const t = setTimeout(() => {
      map.invalidateSize();
      if (points.length === 1) {
        map.setView(points[0], 14);
      } else {
        map.fitBounds(L.latLngBounds(points), { padding: [55, 55], maxZoom: 15 });
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, suppressed, map]);
  return null;
}

// Flies to a selected group and opens its popup once movement settles.
function FlyToSelected({ selected, markerRefs }) {
  const map = useMap();
  useEffect(() => {
    if (!selected) return;
    const target = [parseFloat(selected.lat), parseFloat(selected.lng)];
    map.flyTo(target, 16, { duration: 0.6 });
    const onEnd = () => {
      const m = markerRefs.current[selected.id];
      if (m) m.openPopup();
      map.off("moveend", onEnd);
    };
    map.on("moveend", onEnd);
    return () => map.off("moveend", onEnd);
  }, [selected, map, markerRefs]);
  return null;
}

// Open the signup in a centered popup window. If the browser's popup blocker
// stops window.open (returns null), we let the anchor's default target="_blank"
// navigation proceed instead, so the user still reaches the signup in a new tab.
function openSignup(e, url) {
  const w = 480;
  const h = 720;
  const left = window.screenX + (window.outerWidth - w) / 2;
  const top = window.screenY + (window.outerHeight - h) / 2;
  const win = window.open(
    url,
    "cg-apply",
    `popup=yes,width=${w},height=${h},left=${left},top=${top}`
  );
  if (win) {
    e.preventDefault();
    win.focus();
  }
}

// Number of nearby groups the map frames when a location is set.
const NEAREST_FIT = 6;

export default function App() {
  const [groups, setGroups] = useState([]);
  const [status, setStatus] = useState("loading");
  const [query, setQuery] = useState("");
  const [activeDays, setActiveDays] = useState(() => new Set());
  const [selected, setSelected] = useState(null);

  const [address, setAddress] = useState("");
  const [origin, setOrigin] = useState(null); // { lat, lng, label }
  const [geoStatus, setGeoStatus] = useState("idle"); // idle | loading | error

  const markerRefs = useRef({});

  useEffect(() => {
    fetch("/api/groups")
      .then((r) => {
        if (!r.ok) throw new Error("bad response");
        return r.json();
      })
      .then((d) => {
        setGroups(d.groups || []);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  // Text + day filtering.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups.filter((g) => {
      if (activeDays.size && !activeDays.has(g.day)) return false;
      if (!q) return true;
      return (
        g.name.toLowerCase().includes(q) ||
        (g.description || "").toLowerCase().includes(q) ||
        (g.locationName || "").toLowerCase().includes(q)
      );
    });
  }, [groups, query, activeDays]);

  // Attach distance + sort by proximity when an origin is set.
  const ordered = useMemo(() => {
    if (!origin) return filtered;
    return filtered
      .map((g) => ({
        ...g,
        dist: distanceKm(origin.lat, origin.lng, parseFloat(g.lat), parseFloat(g.lng)),
      }))
      .sort((a, b) => a.dist - b.dist);
  }, [filtered, origin]);

  // Points the map frames: origin + nearest few, or all filtered groups.
  const fitPoints = useMemo(() => {
    if (origin) {
      const near = ordered
        .slice(0, NEAREST_FIT)
        .map((g) => [parseFloat(g.lat), parseFloat(g.lng)]);
      return [[origin.lat, origin.lng], ...near];
    }
    return filtered.map((g) => [parseFloat(g.lat), parseFloat(g.lng)]);
  }, [origin, ordered, filtered]);

  const center = useMemo(() => {
    if (!groups.length) return [43.6532, -79.3832];
    const lat = groups.reduce((s, g) => s + parseFloat(g.lat), 0) / groups.length;
    const lng = groups.reduce((s, g) => s + parseFloat(g.lng), 0) / groups.length;
    return [lat, lng];
  }, [groups]);

  function toggleDay(full) {
    setActiveDays((prev) => {
      const next = new Set(prev);
      next.has(full) ? next.delete(full) : next.add(full);
      return next;
    });
  }

  async function geocodeAddress(e) {
    e?.preventDefault();
    const q = address.trim();
    if (!q) return;
    setGeoStatus("loading");
    setSelected(null);
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      if (!r.ok) throw new Error("geocode failed");
      const d = await r.json();
      setOrigin({ lat: d.lat, lng: d.lng, label: d.label });
      setGeoStatus("idle");
    } catch {
      setGeoStatus("error");
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setGeoStatus("error");
      return;
    }
    setGeoStatus("loading");
    setSelected(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: "My location",
        });
        setAddress("");
        setGeoStatus("idle");
      },
      () => setGeoStatus("error"),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  function clearLocation() {
    setOrigin(null);
    setAddress("");
    setGeoStatus("idle");
  }

  const shortLabel = origin
    ? origin.label.split(",").slice(0, 2).join(",").trim()
    : "";

  return (
    <div className="cg-app">
      <aside className="cg-sidebar">
        <div className="cg-brand">
          <span className="cg-dot" />
          Connect Groups
        </div>

        <div className="cg-search">
          <input
            type="text"
            placeholder="Search groups…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* --- Location / proximity --- */}
        <form className="cg-loc" onSubmit={geocodeAddress}>
          <div className="cg-loc-row">
            <input
              type="text"
              placeholder="Find groups near an address…"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            <button type="submit" className="cg-loc-go" aria-label="Search location">
              →
            </button>
          </div>
          <div className="cg-loc-actions">
            <button type="button" className="cg-loc-me" onClick={useMyLocation}>
              ◎ Use my location
            </button>
            {geoStatus === "loading" && <span className="cg-loc-hint">Locating…</span>}
            {geoStatus === "error" && (
              <span className="cg-loc-hint err">Couldn’t find that location</span>
            )}
          </div>
          {origin && (
            <div className="cg-loc-pill">
              <span>📍 Near {shortLabel}</span>
              <button type="button" onClick={clearLocation} aria-label="Clear location">
                ✕
              </button>
            </div>
          )}
        </form>

        <div className="cg-chips">
          {DAYS.map((d) => {
            const full = DAY_FULL[d];
            const on = activeDays.has(full);
            return (
              <button
                key={d}
                className={`cg-chip ${on ? "on" : ""}`}
                onClick={() => toggleDay(full)}
              >
                {d}
              </button>
            );
          })}
          {activeDays.size > 0 && (
            <button className="cg-chip clear" onClick={() => setActiveDays(new Set())}>
              Clear
            </button>
          )}
        </div>

        <div className="cg-count">
          {status === "ready"
            ? `${ordered.length} of ${groups.length} groups${
                origin ? " · nearest first" : ""
              }`
            : ""}
        </div>

        <div className="cg-list">
          {status === "loading" && <div className="cg-empty">Loading…</div>}
          {status === "error" && (
            <div className="cg-empty">Couldn’t load groups. Is the API running?</div>
          )}
          {status === "ready" && ordered.length === 0 && (
            <div className="cg-empty">No groups match your filters.</div>
          )}
          {ordered.map((g) => (
            <button
              key={g.id}
              className={`cg-item ${selected?.id === g.id ? "active" : ""}`}
              onClick={() => setSelected({ ...g })}
            >
              <div className="cg-item-title">{g.name}</div>
              <div className="cg-item-meta">
                {origin && (
                  <span className="cg-dist">{g.dist.toFixed(1)} km</span>
                )}
                {g.day ? `${g.day}` : "—"}
                {g.locationName ? ` · ${g.locationName}` : ""}
              </div>
            </button>
          ))}
        </div>
      </aside>

      <div className="cg-map-wrap">
        <MapContainer center={center} zoom={11} className="cg-map" scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          <FitToPoints points={fitPoints} suppressed={!!selected} />
          <FlyToSelected selected={selected} markerRefs={markerRefs} />
          {origin && (
            <Marker position={[origin.lat, origin.lng]} icon={originIcon} zIndexOffset={1000}>
              <Popup className="cg-popup">
                <div className="cg-card-body">
                  <strong>{origin.label === "My location" ? "My location" : "Your location"}</strong>
                  <div className="cg-meta" style={{ marginTop: 6 }}>{shortLabel}</div>
                </div>
              </Popup>
            </Marker>
          )}
          <MarkerClusterGroup chunkedLoading maxClusterRadius={50}>
            {ordered.map((g) => (
              <Marker
                key={g.id}
                position={[parseFloat(g.lat), parseFloat(g.lng)]}
                icon={pinIcon}
                ref={(r) => {
                  if (r) markerRefs.current[g.id] = r;
                  else delete markerRefs.current[g.id];
                }}
              >
                <Popup className="cg-popup" maxWidth={300} minWidth={260}>
                  <div className="cg-card">
                    {g.image && (
                      <div
                        className="cg-card-img"
                        style={{ backgroundImage: `url(${g.image})` }}
                      />
                    )}
                    <div className="cg-card-body">
                      <h3 className="cg-card-title">{g.name}</h3>
                      {origin && (
                        <div className="cg-meta">📏 {g.dist.toFixed(1)} km away</div>
                      )}
                      {g.schedule && <div className="cg-meta">🗓 {g.schedule}</div>}
                      {g.locationName && <div className="cg-meta">📍 {g.locationName}</div>}
                      {g.description && <p className="cg-desc">{g.description}</p>}
                      <a
                        className="cg-apply"
                        href={g.signupUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => openSignup(e, g.signupUrl)}
                      >
                        Apply to join
                      </a>
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MarkerClusterGroup>
        </MapContainer>
      </div>
    </div>
  );
}
