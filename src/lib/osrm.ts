// OSRM public demo routing client. Returns a real road-following route with
// turn-by-turn steps. Coordinates are [lat, lng] for consistency with Leaflet.

export interface NavStep {
  instruction: string;
  distanceM: number;
  durationS: number;
  maneuverLocation: [number, number];
  name: string;
  type: string;
  modifier?: string;
}

export interface NavRoute {
  geometry: [number, number][];
  distanceM: number;
  durationS: number;
  steps: NavStep[];
}

function humanize(s: any): string {
  const t = s.maneuver?.type ?? "";
  const m = s.maneuver?.modifier ?? "";
  const name = s.name ? ` onto ${s.name}` : "";
  if (t === "depart") return `Head ${m || "straight"}${name}`;
  if (t === "arrive") return `You have arrived at your destination`;
  if (t === "turn") return `Turn ${m}${name}`;
  if (t === "new name") return `Continue${name}`;
  if (t === "merge") return `Merge ${m}${name}`;
  if (t === "on ramp") return `Take the ramp ${m}${name}`;
  if (t === "off ramp") return `Take the exit ${m}${name}`;
  if (t === "fork") return `Keep ${m}${name}`;
  if (t === "end of road") return `At the end of the road, turn ${m}${name}`;
  if (t === "continue") return `Continue ${m}${name}`;
  if (t === "roundabout" || t === "rotary") return `Enter the roundabout${name}`;
  if (t === "exit roundabout" || t === "exit rotary") return `Exit the roundabout${name}`;
  return `${t} ${m}${name}`.trim() || "Continue";
}

export async function fetchOsrmRoute(
  from: [number, number],
  to: [number, number],
): Promise<NavRoute | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson&steps=true`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j: any = await r.json();
    const route = j.routes?.[0];
    if (!route) return null;
    const geometry: [number, number][] = route.geometry.coordinates.map(
      (c: [number, number]) => [c[1], c[0]],
    );
    const steps: NavStep[] = (route.legs?.[0]?.steps ?? []).map((s: any) => ({
      instruction: humanize(s),
      distanceM: s.distance ?? 0,
      durationS: s.duration ?? 0,
      maneuverLocation: [s.maneuver.location[1], s.maneuver.location[0]],
      name: s.name || "",
      type: s.maneuver?.type ?? "",
      modifier: s.maneuver?.modifier,
    }));
    return {
      geometry,
      distanceM: route.distance,
      durationS: route.duration,
      steps,
    };
  } catch (e) {
    console.error("OSRM fetch failed", e);
    return null;
  }
}

export function haversineM(a: [number, number], b: [number, number]) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}