import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import type { RouteOption } from "@/data/routes";
import { setSharedMap, invalidateSharedMap } from "@/lib/mapRef";

// Publishes the Leaflet map instance to a module-level ref so floating
// overlays (NavigationView) can attach markers/polylines to the SAME map,
// guaranteeing a single MapContainer instance for the whole app. Also
// invalidates size on window resize so the map never renders half-empty.
function MapRefBridge() {
  const map = useMap();
  useEffect(() => {
    setSharedMap(map);
    invalidateSharedMap(50);
    invalidateSharedMap(300);
    const onResize = () => invalidateSharedMap(300);
    window.addEventListener("resize", onResize);
    const container = map.getContainer();
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => invalidateSharedMap(300))
        : null;
    resizeObserver?.observe(container);
    return () => {
      window.removeEventListener("resize", onResize);
      resizeObserver?.disconnect();
      setSharedMap(null);
    };
  }, [map]);
  return null;
}

// Fix default marker icons (Leaflet + bundlers)
const startIcon = L.divIcon({
  className: "",
  html: `<div style="width:18px;height:18px;border-radius:50%;background:oklch(0.78 0.16 210);border:3px solid white;box-shadow:0 0 0 3px oklch(0.78 0.16 210 / 35%)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});
const endIcon = L.divIcon({
  className: "",
  html: `<div style="width:18px;height:18px;border-radius:50%;background:oklch(0.75 0.18 165);border:3px solid white;box-shadow:0 0 0 3px oklch(0.75 0.18 165 / 35%)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function hazardIcon(svg: string, color: string) {
  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:32px;height:32px;display:grid;place-items:center;">
        <div style="position:absolute;inset:0;border-radius:50%;background:${color};opacity:0.18;"></div>
        <div style="position:relative;width:26px;height:26px;border-radius:50%;background:${color};display:grid;place-items:center;box-shadow:0 4px 10px rgba(0,0,0,0.18), 0 0 0 2px white;">
          ${svg}
        </div>
      </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}
const ICON_DROP = `<svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="0.5"><path d="M12 2s6 7.5 6 12a6 6 0 1 1-12 0c0-4.5 6-12 6-12z"/></svg>`;
const ICON_CONE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M12 2 L20 22 H4 Z" stroke="white" stroke-width="0.5"/></svg>`;
const ICON_BLOCK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M6 6 L18 18"/></svg>`;
const waterHazard = hazardIcon(ICON_DROP, "oklch(0.6 0.18 230)");
const potholeHazard = hazardIcon(ICON_CONE, "oklch(0.7 0.18 60)");
const blockedHazard = hazardIcon(ICON_BLOCK, "oklch(0.58 0.24 25)");

// Pick a reasonable mid-segment point on a route path (~60% along).
function pickHazardPoint(path: [number, number][], offset = 0.6) {
  if (!path.length) return null;
  const idx = Math.min(path.length - 1, Math.max(0, Math.floor(path.length * offset)));
  return path[idx];
}

// Alternative-route palette (never green — green is reserved for the
// recommended/selected route so it visually pops like Google Maps).
function altColorFor(score: number) {
  if (score >= 10) return "oklch(0.78 0.17 75)"; // amber/yellow — moderate
  if (score >= 7) return "oklch(0.72 0.2 45)"; // orange — risky
  return "oklch(0.62 0.24 25)"; // red — unsafe
}
const RECOMMENDED_GREEN = "oklch(0.62 0.17 152)";

function FocusBounds({ routes, selectedId }: { routes: RouteOption[]; selectedId?: string }) {
  const map = useMap();
  useEffect(() => {
    if (!routes.length) return;
    const target = selectedId ? routes.find((r) => r.id === selectedId) : null;
    const pts = target ? target.path : routes.flatMap((r) => r.path);
    if (!pts.length) return;
    const bounds = L.latLngBounds(pts.map((p) => L.latLng(p[0], p[1])));
    try {
      map.flyToBounds(bounds, { padding: [80, 80], duration: 0.6 });
    } catch {
      map.fitBounds(bounds, { padding: [80, 80] });
    }
  }, [map, routes, selectedId]);
  return null;
}

interface Props {
  routes: RouteOption[];
  bestId?: string;
  selectedId?: string;
  navigationMode?: boolean;
  onSelect?: (id: string) => void;
}

export function RouteMap({ routes, bestId, selectedId, navigationMode = false, onSelect }: Props) {
  const center = useMemo<[number, number]>(() => {
    if (routes[0]?.path[0]) return routes[0].path[0];
    return [17.45, 78.43];
  }, [routes]);

  const start = routes[0]?.path[0];
  const end = routes[0]?.path[routes[0].path.length - 1];

  // Render selected polyline last so it sits on top.
  const ordered = useMemo(() => {
    const topId = selectedId ?? bestId;
    if (!topId) return routes;
    const others = routes.filter((r) => r.id !== topId);
    const top = routes.find((r) => r.id === topId);
    return top ? [...others, top] : routes;
  }, [routes, selectedId, bestId]);

  return (
    <MapContainer
      center={center}
      zoom={13}
      scrollWheelZoom
      doubleClickZoom
      touchZoom
      dragging
      className="saferoute-map-container"
    >
      <MapRefBridge />
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {!navigationMode && <FocusBounds routes={routes} selectedId={selectedId} />}
      {!navigationMode && ordered.map((r) => {
        const isSelected = r.id === selectedId;
        const isBest = r.id === bestId;
        // The "highlighted" route is the user's selection, or the best route
        // when no explicit selection has been made yet.
        const isHighlighted = isSelected || (!selectedId && isBest);
        // Selected route: bright color based on score (green for safe, amber moderate, red risky).
        // All others: subtle light gray solid lines that fade into the background — no dashes.
        const selectedColor =
          r.totalScore >= 11 ? RECOMMENDED_GREEN : altColorFor(r.totalScore);
        const color = isHighlighted ? selectedColor : "oklch(0.75 0.02 250)";
        const weight = isHighlighted ? 8 : 3;
        const opacity = isHighlighted ? 1 : 0.18;
        return (
          <Polyline
            key={r.id}
            positions={r.path}
            pathOptions={{
              color,
              weight,
              opacity,
              lineCap: "round",
              lineJoin: "round",
            }}
            eventHandlers={{ click: () => onSelect?.(r.id) }}
          >
            <Popup>
              <div className="text-sm">
                <div className="font-semibold">{r.name}</div>
                <div>Safety: {r.totalScore}/15</div>
                <div>ETA: {r.etaMin} min · {r.distanceKm.toFixed(1)} km</div>
                <button
                  onClick={() => onSelect?.(r.id)}
                  className="mt-1 text-xs underline text-primary"
                >
                  Select this route
                </button>
              </div>
            </Popup>
          </Polyline>
        );
      })}
      {!navigationMode && start && (
        <Marker position={start} icon={startIcon}>
          <Popup>Start: {routes[0].from}</Popup>
        </Marker>
      )}
      {!navigationMode && end && (
        <Marker position={end} icon={endIcon}>
          <Popup>Destination: {routes[0].to}</Popup>
        </Marker>
      )}
      {/* Hazard markers — only on alternative (non-recommended) routes so the
          recommended route reads as visibly clean. */}
      {!navigationMode && routes
        .filter((r) => r.id !== bestId)
        .flatMap((r) => {
          const hazards: { pt: [number, number]; icon: L.DivIcon; label: string }[] = [];
          if (r.waterlogging) {
            const pt = pickHazardPoint(r.path, 0.55);
            if (pt) hazards.push({ pt, icon: waterHazard, label: `Waterlogging reported on ${r.name}` });
          }
          if (r.road === "bad") {
            const pt = pickHazardPoint(r.path, 0.4);
            if (pt) hazards.push({ pt, icon: potholeHazard, label: `Potholes detected on ${r.name}` });
          } else if (r.road === "moderate" && r.id !== selectedId) {
            const pt = pickHazardPoint(r.path, 0.7);
            if (pt) hazards.push({ pt, icon: potholeHazard, label: `Rough patches on ${r.name}` });
          }
          if (r.totalScore < 6) {
            const pt = pickHazardPoint(r.path, 0.3);
            if (pt) hazards.push({ pt, icon: blockedHazard, label: `Unsafe conditions on ${r.name}` });
          }
          return hazards.map((h, i) => (
            <Marker key={`${r.id}-hz-${i}`} position={h.pt} icon={h.icon}>
              <Popup>
                <div className="text-xs font-medium">{h.label}</div>
              </Popup>
            </Marker>
          ));
        })}
    </MapContainer>
  );
}
