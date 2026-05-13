// Server functions: geocode arbitrary inputs, generate 3 synthetic routes,
// score them with explainable multi-factor logic, and accept user reports.
import { createServerFn } from "@tanstack/react-start";
import {
  getRoutesKey,
  type Coord,
  type EvaluateResponse,
  type RouteData,
  type RouteOption,
  type TrafficLevel,
} from "@/data/routes";

// In-memory dynamic reports overlay (keyed by route signature).
const REPORTS: Record<string, { potholes: number; water: number; blocked: number }> = {};

function getTimeOfDay(): "morning" | "afternoon" | "evening" | "night" {
  const h = new Date().getHours();
  if (h >= 6 && h < 11) return "morning";
  if (h >= 11 && h < 16) return "afternoon";
  if (h >= 16 && h < 21) return "evening";
  return "night";
}

// Time-based default traffic per spec: morning=high, afternoon=medium, night=low.
function trafficForTimeOfDay(tod: string): TrafficLevel {
  if (tod === "morning" || tod === "evening") return "high";
  if (tod === "afternoon") return "medium";
  return "low";
}

function bumpTraffic(t: TrafficLevel, delta: number): TrafficLevel {
  const order: TrafficLevel[] = ["low", "medium", "high"];
  const idx = Math.max(0, Math.min(2, order.indexOf(t) + delta));
  return order[idx];
}

function trafficScore(t: TrafficLevel) {
  return t === "low" ? 5 : t === "medium" ? 3 : 1;
}
function roadScore(r: RoadCondition) {
  return r === "good" ? 5 : r === "moderate" ? 3 : 1;
}
function waterScore(w: boolean) {
  return w ? 0 : 5;
}

type RoadCondition = "good" | "moderate" | "bad";

function buildReasons(opt: { traffic: TrafficLevel; road: RoadCondition; waterlogging: boolean }) {
  const r: string[] = [];
  r.push(
    opt.traffic === "low"
      ? "Low traffic (+5)"
      : opt.traffic === "medium"
      ? "Moderate traffic (+3)"
      : "Heavy traffic (+1)",
  );
  r.push(
    opt.road === "good"
      ? "Good road (+5)"
      : opt.road === "moderate"
      ? "Moderate road (+3)"
      : "Poor road (+1)",
  );
  r.push(opt.waterlogging ? "Waterlogging reported (+0)" : "No waterlogging (+5)");
  return r;
}

// ---------- Geocoding (OpenStreetMap Nominatim) ----------
interface GeoPoint {
  lat: number;
  lng: number;
  label: string;
}

async function geocode(query: string): Promise<GeoPoint | null> {
  // Local fallback dictionary so common Hyderabad locations (and a few others)
  // resolve instantly even if Nominatim is rate-limited or unreachable.
  const LOCAL: Record<string, { lat: number; lng: number; label: string }> = {
    "ameerpet":      { lat: 17.4375, lng: 78.4483, label: "Ameerpet, Hyderabad" },
    "kukatpally":    { lat: 17.4948, lng: 78.3996, label: "Kukatpally, Hyderabad" },
    "madhapur":      { lat: 17.4483, lng: 78.3915, label: "Madhapur, Hyderabad" },
    "hitech city":   { lat: 17.4435, lng: 78.3772, label: "Hitech City, Hyderabad" },
    "hi-tech city":  { lat: 17.4435, lng: 78.3772, label: "Hitech City, Hyderabad" },
    "hitec city":    { lat: 17.4435, lng: 78.3772, label: "Hitech City, Hyderabad" },
    "gachibowli":    { lat: 17.4401, lng: 78.3489, label: "Gachibowli, Hyderabad" },
    "secunderabad":  { lat: 17.4399, lng: 78.4983, label: "Secunderabad, Hyderabad" },
    "banjara hills": { lat: 17.4156, lng: 78.4347, label: "Banjara Hills, Hyderabad" },
    "jubilee hills": { lat: 17.4239, lng: 78.4071, label: "Jubilee Hills, Hyderabad" },
    "begumpet":      { lat: 17.4399, lng: 78.4738, label: "Begumpet, Hyderabad" },
    "kphb":          { lat: 17.4849, lng: 78.3915, label: "KPHB, Hyderabad" },
    "miyapur":       { lat: 17.4969, lng: 78.3713, label: "Miyapur, Hyderabad" },
    "lb nagar":      { lat: 17.3468, lng: 78.5500, label: "LB Nagar, Hyderabad" },
    "dilsukhnagar":  { lat: 17.3687, lng: 78.5247, label: "Dilsukhnagar, Hyderabad" },
    "charminar":     { lat: 17.3616, lng: 78.4747, label: "Charminar, Hyderabad" },
    "mehdipatnam":   { lat: 17.3960, lng: 78.4400, label: "Mehdipatnam, Hyderabad" },
    "uppal":         { lat: 17.4055, lng: 78.5591, label: "Uppal, Hyderabad" },
  };
  const norm = query
    .toLowerCase()
    .replace(/,\s*hyderabad.*$/i, "")
    .replace(/,\s*telangana.*$/i, "")
    .replace(/,\s*india.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (LOCAL[norm]) return LOCAL[norm];

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: {
        // Nominatim requires a UA / referer.
        "User-Agent": "SafeRoute-Demo/1.0 (hackathon prototype)",
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      // Retry once appending ", Hyderabad" for short single-word names.
      if (!/,/.test(query)) {
        const retry = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query + ", India")}`,
          { headers: { "User-Agent": "SafeRoute-Demo/1.0", Accept: "application/json" } },
        );
        if (retry.ok) {
          const j = (await retry.json()) as Array<{ lat: string; lon: string; display_name: string }>;
          if (j.length) {
            const t = j[0];
            return { lat: parseFloat(t.lat), lng: parseFloat(t.lon), label: t.display_name.split(",").slice(0, 2).join(",").trim() };
          }
        }
      }
      return null;
    }
    const json = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
    if (!json.length) return null;
    const top = json[0];
    return {
      lat: parseFloat(top.lat),
      lng: parseFloat(top.lon),
      label: top.display_name.split(",").slice(0, 2).join(",").trim(),
    };
  } catch (e) {
    console.error("geocode failed for", query, e);
    return null;
  }
}

// ---------- Synthetic route generator ----------
// Produces a curved polyline between two coords by offsetting the midpoint
// perpendicular to the start→end vector. `bend` controls curvature (+/-).
function curvedPath(a: Coord, b: Coord, bend: number, steps = 18): Coord[] {
  const [lat1, lng1] = a;
  const [lat2, lng2] = b;
  const dx = lat2 - lat1;
  const dy = lng2 - lng1;
  // Perpendicular unit-ish offset (small magnitude for map realism).
  const nx = -dy;
  const ny = dx;
  const norm = Math.hypot(nx, ny) || 1;
  const ox = (nx / norm) * bend;
  const oy = (ny / norm) * bend;
  const mLat = (lat1 + lat2) / 2 + ox;
  const mLng = (lng1 + lng2) / 2 + oy;

  const pts: Coord[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Quadratic Bezier: (1-t)^2 * a + 2(1-t)t * m + t^2 * b
    const u = 1 - t;
    const lat = u * u * lat1 + 2 * u * t * mLat + t * t * lat2;
    const lng = u * u * lng1 + 2 * u * t * mLng + t * t * lng2;
    pts.push([lat, lng]);
  }
  return pts;
}

function haversineKm(a: Coord, b: Coord) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function pathDistanceKm(path: Coord[]) {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineKm(path[i - 1], path[i]);
  return total;
}

function generateRoutes(from: GeoPoint, to: GeoPoint, fromLabel: string, toLabel: string): RouteData[] {
  const a: Coord = [from.lat, from.lng];
  const b: Coord = [to.lat, to.lng];
  const baseDist = haversineKm(a, b);
  // Bend magnitude scaled by distance (in degrees). Small for short trips.
  const bendMag = Math.min(0.35, Math.max(0.012, baseDist * 0.06));

  // Generate routes that bend in different directions and magnitudes so the
  // map shows alternatives spreading on BOTH sides of the straight line.
  const variants: Array<{
    name: string;
    bend: number;
    road: RoadCondition;
    water: boolean;
    trafficDelta: number; // adjust vs time-of-day baseline
    speedKmh: number;
  }> = [
    { name: "Route 1 · Main highway",      bend: 0,             road: "good",     water: false, trafficDelta: 0,  speedKmh: 32 },
    { name: "Route 2 · North arterial",    bend: bendMag,       road: "moderate", water: true,  trafficDelta: +1, speedKmh: 24 },
    { name: "Route 3 · South bypass",      bend: -bendMag,      road: "moderate", water: false, trafficDelta: -1, speedKmh: 28 },
    { name: "Route 4 · Outer ring detour", bend: bendMag * 1.8, road: "good",     water: false, trafficDelta: -1, speedKmh: 36 },
    { name: "Route 5 · Inner shortcut",    bend: -bendMag * 0.6, road: "bad",     water: true,  trafficDelta: +1, speedKmh: 18 },
  ];

  return variants.map((v, i) => {
    const path = curvedPath(a, b, v.bend);
    const distanceKm = pathDistanceKm(path);
    const etaMin = Math.max(3, Math.round((distanceKm / v.speedKmh) * 60));
    return {
      id: `r${i + 1}`,
      name: v.name,
      from: fromLabel,
      to: toLabel,
      baseTraffic: bumpTraffic(trafficForTimeOfDay(getTimeOfDay()), v.trafficDelta),
      road: v.road,
      waterlogging: v.water,
      distanceKm,
      etaMin,
      path,
    };
  });
}

// Fetch real road-following alternatives from the OSRM public demo server.
async function fetchOsrmAlternatives(
  a: Coord,
  b: Coord,
): Promise<Array<{ path: Coord[]; distanceKm: number; durationMin: number }>> {
  const url = `https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson&alternatives=3`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "SafeRoute-Demo/1.0", Accept: "application/json" },
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    const routes: any[] = json.routes ?? [];
    return routes.map((r) => ({
      path: (r.geometry.coordinates as [number, number][]).map(
        ([lng, lat]) => [lat, lng] as Coord,
      ),
      distanceKm: (r.distance ?? 0) / 1000,
      durationMin: Math.max(1, Math.round((r.duration ?? 0) / 60)),
    }));
  } catch (e) {
    console.error("OSRM alternatives fetch failed", e);
    return [];
  }
}

// ---------- Evaluation ----------
function evaluate(routes: RouteData[], reportKey: string): EvaluateResponse {
  const tod = getTimeOfDay();

  const evaluated: RouteOption[] = routes.map((r) => {
    const reports = REPORTS[`${reportKey}::${r.id}`] ?? { potholes: 0, water: 0, blocked: 0 };
    const traffic = r.baseTraffic;
    const road: RoadCondition =
      reports.potholes >= 2 ? "bad" : reports.potholes === 1 && r.road === "good" ? "moderate" : r.road;
    const waterlogging = r.waterlogging || reports.water > 0;

    const tS = trafficScore(traffic);
    const rS = roadScore(road);
    const wS = waterScore(waterlogging);
    const blockedPenalty = reports.blocked > 0 ? 5 : 0;
    const total = Math.max(0, tS + rS + wS - blockedPenalty);

    return {
      id: r.id,
      name: r.name,
      from: r.from,
      to: r.to,
      traffic,
      road,
      waterlogging,
      distanceKm: r.distanceKm,
      etaMin: r.etaMin,
      path: r.path,
      trafficScore: tS,
      roadScore: rS,
      waterScore: wS,
      totalScore: total,
      reasons: [
        ...buildReasons({ traffic, road, waterlogging }),
        ...(reports.blocked > 0 ? ["Road block reported (-5)"] : []),
      ],
    };
  });

  evaluated.sort((a, b) => b.totalScore - a.totalScore);
  const best = evaluated[0];

  const conditions: string[] = [];
  conditions.push(
    best.traffic === "low"
      ? "low traffic"
      : best.traffic === "medium"
        ? "moderate traffic"
        : "heavy traffic",
  );
  conditions.push(
    best.road === "good"
      ? "good road conditions"
      : best.road === "moderate"
        ? "moderate road conditions"
        : "poor road conditions",
  );
  conditions.push(best.waterlogging ? "but watch for waterlogging" : "and no waterlogging");
  const spokenSummary = `The recommended safest route is ${best.name}. It is chosen because it has ${conditions.join(", ")}. Estimated ${best.etaMin} minutes over ${best.distanceKm.toFixed(1)} kilometers.`;

  return {
    best,
    routes: evaluated,
    timeOfDay: tod,
    spokenSummary,
    fromLabel: routes[0]?.from ?? "",
    toLabel: routes[0]?.to ?? "",
  };
}

// ---------- Server functions ----------
export const evaluateRoutes = createServerFn({ method: "POST" })
  .inputValidator((input: { from: string; to: string }) => {
    if (!input || typeof input.from !== "string" || typeof input.to !== "string") {
      throw new Error("Invalid input");
    }
    const from = input.from.trim().slice(0, 120);
    const to = input.to.trim().slice(0, 120);
    if (!from || !to) throw new Error("From and To are required");
    return { from, to };
  })
  .handler(async ({ data }): Promise<EvaluateResponse | { error: string }> => {
    const [fromGeo, toGeo] = await Promise.all([geocode(data.from), geocode(data.to)]);
    if (!fromGeo) return { error: `Couldn't find location: "${data.from}".` };
    if (!toGeo) return { error: `Couldn't find location: "${data.to}".` };
    if (haversineKm([fromGeo.lat, fromGeo.lng], [toGeo.lat, toGeo.lng]) < 0.05) {
      return { error: "Source and destination look identical. Try different places." };
    }
    const fromLabel = fromGeo.label || data.from;
    const toLabel = toGeo.label || data.to;
    let routes = generateRoutes(fromGeo, toGeo, fromLabel, toLabel);
    // Replace synthetic curved paths with real road-following geometry from OSRM.
    const real = await fetchOsrmAlternatives(
      [fromGeo.lat, fromGeo.lng],
      [toGeo.lat, toGeo.lng],
    );
    if (real.length > 0) {
      routes = routes.slice(0, Math.max(real.length, 3)).map((r, i) => {
        const pick = real[i % real.length];
        return {
          ...r,
          path: pick.path,
          distanceKm: pick.distanceKm,
          etaMin: pick.durationMin,
        };
      });
    }
    return evaluate(routes, getRoutesKey(data.from, data.to));
  });

export const reportIssue = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { reportKey: string; routeId: string; type: "pothole" | "waterlogging" | "blocked" }) => {
      if (!input || !["pothole", "waterlogging", "blocked"].includes(input.type)) {
        throw new Error("Invalid report");
      }
      if (!input.reportKey || !input.routeId) throw new Error("Missing route");
      return input;
    },
  )
  .handler(async ({ data }) => {
    const k = `${data.reportKey}::${data.routeId}`;
    const cur = REPORTS[k] ?? { potholes: 0, water: 0, blocked: 0 };
    if (data.type === "pothole") cur.potholes += 1;
    if (data.type === "waterlogging") cur.water += 1;
    if (data.type === "blocked") cur.blocked += 1;
    REPORTS[k] = cur;
    return { ok: true, reports: cur };
  });
