import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { fetchOsrmRoute, haversineM, type NavRoute } from "@/lib/osrm";
import { getSharedMap, subscribeSharedMap, invalidateSharedMap } from "@/lib/mapRef";
import { speak, createUtterance, warmUpSpeech } from "@/lib/voice";
import {
  Navigation,
  X,
  Volume2,
  VolumeX,
  Compass,
  LocateFixed,
  Crosshair,
  Gauge,
  ArrowUp,
  ArrowUpRight,
  ArrowUpLeft,
  CornerUpLeft,
  CornerUpRight,
  RotateCw,
  Flag,
  Clock,
} from "lucide-react";

function ManeuverIcon({ type, modifier, className }: { type?: string; modifier?: string; className?: string }) {
  const cls = className ?? "h-6 w-6";
  if (type === "arrive") return <Flag className={cls} />;
  if (type === "roundabout" || type === "rotary") return <RotateCw className={cls} />;
  if (type === "turn" || type === "end of road" || type === "on ramp" || type === "off ramp" || type === "fork" || type === "merge") {
    if (modifier?.includes("sharp left") || modifier === "left") return <CornerUpLeft className={cls} />;
    if (modifier?.includes("sharp right") || modifier === "right") return <CornerUpRight className={cls} />;
    if (modifier?.includes("slight left")) return <ArrowUpLeft className={cls} />;
    if (modifier?.includes("slight right")) return <ArrowUpRight className={cls} />;
  }
  return <ArrowUp className={cls} />;
}

function makeUserIcon(bearing: number) {
  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:44px;height:44px;display:grid;place-items:center;">
        <div style="position:absolute;inset:0;border-radius:50%;background:rgba(37,99,235,0.18);animation:pulse-ring 2s ease-out infinite;"></div>
        <div style="position:relative;width:30px;height:30px;border-radius:50%;background:#2563eb;display:grid;place-items:center;box-shadow:0 4px 14px rgba(37,99,235,0.55), 0 0 0 3px white;z-index:2;">
          <div style="transform:rotate(${bearing}deg);transition:transform 200ms ease-out;width:18px;height:18px;display:grid;place-items:center;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="white" stroke="white" stroke-width="1" stroke-linejoin="round"><path d="M12 3 L19 21 L12 17 L5 21 Z"/></svg>
          </div>
        </div>
      </div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}
const destIcon = L.divIcon({
  className: "",
  html: `<div style="width:18px;height:18px;border-radius:50%;background:oklch(0.62 0.17 152);border:3px solid white;box-shadow:0 0 0 4px oklch(0.62 0.17 152 / 35%)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});


interface Props {
  destination: [number, number];
  destLabel: string;
  onClose: () => void;
}

export function NavigationView({ destination, destLabel, onClose }: Props) {
  const [pos, setPos] = useState<[number, number] | null>(null);
  const [speedKmh, setSpeedKmh] = useState<number>(0);
  const [bearing, setBearing] = useState<number>(0);
  const prevPosRef = useRef<[number, number] | null>(null);
  const [route, setRoute] = useState<NavRoute | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [muted, setMuted] = useState(false);
  const announcedAheadRef = useRef<Set<number>>(new Set());
  const spokenRef = useRef<Set<number>>(new Set());
  const lastSpeakAtRef = useRef<number>(0);
  const [nearestIdx, setNearestIdx] = useState(0);
  const stepListRef = useRef<HTMLDivElement | null>(null);
  const markerAnimRef = useRef<number | null>(null);

  function speakDebounced(text: string, minGapMs = 4000) {
    if (muted) return;
    const now = Date.now();
    if (now - lastSpeakAtRef.current < minGapMs) return;
    lastSpeakAtRef.current = now;
    speak(text);
  }

  // Cancel ongoing speech immediately when muted toggles on
  useEffect(() => {
    if (muted && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, [muted]);

  // Live geolocation
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Geolocation not supported in this browser.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const next: [number, number] = [p.coords.latitude, p.coords.longitude];
        const prev = prevPosRef.current;
        if (prev) {
          const d = haversineM(prev, next);
          if (d > 1) {
            const lat1 = (prev[0] * Math.PI) / 180;
            const lat2 = (next[0] * Math.PI) / 180;
            const dLng = ((next[1] - prev[1]) * Math.PI) / 180;
            const y = Math.sin(dLng) * Math.cos(lat2);
            const x =
              Math.cos(lat1) * Math.sin(lat2) -
              Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
            const brng = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
            setBearing(brng);
          }
        }
        prevPosRef.current = next;
        if (typeof p.coords.speed === "number" && !isNaN(p.coords.speed)) {
          setSpeedKmh(Math.max(0, p.coords.speed * 3.6));
        }
        setPos(next);
      },
      (e) => setError(`Location error: ${e.message}. Allow location access.`),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Fetch real OSRM route once we have a starting position
  useEffect(() => {
    if (!pos || route) return;
    let cancelled = false;
    (async () => {
      const r = await fetchOsrmRoute(pos, destination);
      if (cancelled) return;
      if (!r || !r.steps.length) {
        setError("Could not load turn-by-turn directions.");
        return;
      }
      setRoute(r);
      const u = createUtterance();
      const first = r.steps[0]?.instruction ?? "Starting navigation";
      speak(`Starting navigation to ${destLabel}. ${first}.`, u);
      lastSpeakAtRef.current = Date.now();
      spokenRef.current.add(0);
    })();
    return () => {
      cancelled = true;
    };
  }, [pos, route, destination, destLabel]);

  // Find nearest point on route geometry to track real progress.
  useEffect(() => {
    if (!pos || !route) return;
    let bestI = nearestIdx;
    let bestD = Infinity;
    const start = Math.max(0, nearestIdx - 3);
    const end = Math.min(route.geometry.length, nearestIdx + 80);
    for (let i = start; i < end; i++) {
      const d = haversineM(pos, route.geometry[i]);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    if (bestI !== nearestIdx) setNearestIdx(bestI);
  }, [pos, route, nearestIdx]);

  // Step advancement + debounced voice cues based on real progress.
  useEffect(() => {
    if (!pos || !route) return;
    const steps = route.steps;
    if (stepIdx >= steps.length) return;
    const next = steps[stepIdx];
    const dist = haversineM(pos, next.maneuverLocation);

    if (
      stepIdx > 0 &&
      dist < 60 &&
      dist > 25 &&
      !announcedAheadRef.current.has(stepIdx)
    ) {
      announcedAheadRef.current.add(stepIdx);
      speakDebounced(`In ${Math.round(dist / 10) * 10} meters, ${next.instruction}.`);
    }

    if (dist < 25 && !spokenRef.current.has(stepIdx)) {
      spokenRef.current.add(stepIdx);
      speakDebounced(next.instruction, 1500);
      setStepIdx((i) => i + 1);
      return;
    }

    const distToDest = haversineM(pos, destination);
    if (distToDest < 25 && stepIdx < steps.length) {
      speakDebounced("You have arrived at your destination.", 0);
      setStepIdx(steps.length);
    }
  }, [pos, route, stepIdx, destination]);

  // Auto-scroll step list to keep the active step visible
  useEffect(() => {
    const node = stepListRef.current?.querySelector<HTMLElement>(`[data-step="${stepIdx}"]`);
    node?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [stepIdx]);

  const completedGeom = useMemo(() => {
    if (!route) return [] as [number, number][];
    return route.geometry.slice(0, Math.max(1, nearestIdx + 1));
  }, [route, nearestIdx]);
  const remainingGeom = useMemo(() => {
    if (!route) return [] as [number, number][];
    const slice = route.geometry.slice(nearestIdx);
    return pos ? ([pos, ...slice] as [number, number][]) : slice;
  }, [route, nearestIdx, pos]);

  const remainingDistance = useMemo(() => {
    if (!route) return 0;
    let d = 0;
    for (let i = nearestIdx + 1; i < route.geometry.length; i++) {
      d += haversineM(route.geometry[i - 1], route.geometry[i]);
    }
    return d;
  }, [route, nearestIdx]);
  const remainingDuration = useMemo(() => {
    if (!route || route.distanceM === 0) return 0;
    return (remainingDistance / route.distanceM) * route.durationS;
  }, [route, remainingDistance]);

  const distToNextManeuver = useMemo(() => {
    if (!pos || !route || stepIdx >= route.steps.length) return 0;
    return haversineM(pos, route.steps[stepIdx].maneuverLocation);
  }, [pos, route, stepIdx]);

  const currentStep = route?.steps[stepIdx];
  const arrived = !!route && stepIdx >= route.steps.length;

  const arrivalTime = useMemo(() => {
    if (!route) return "—";
    const eta = new Date(Date.now() + remainingDuration * 1000);
    return eta.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }, [route, remainingDuration]);

  const userIcon = useMemo(() => makeUserIcon(bearing), [bearing]);

  function fmtDist(m: number) {
    return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
  }

  // === Imperatively render navigation layers on the SHARED Leaflet map ===
  // We never mount a second MapContainer. Instead we attach/detach a marker
  // and two polylines (completed=gray, remaining=green) to the same map
  // instance that RouteMap created.
  const layerRef = useRef<{
    map: L.Map | null;
    user: L.Marker | null;
    dest: L.Marker | null;
    remaining: L.Polyline | null;
    completed: L.Polyline | null;
  }>({ map: null, user: null, dest: null, remaining: null, completed: null });

  // Subscribe to the shared map and create the layers once it's available.
  useEffect(() => {
    const attach = (map: L.Map | null) => {
      // Detach old layers if the map changed / unmounted
      const cur = layerRef.current;
      if (cur.map && cur.map !== map) {
        cur.user?.remove();
        cur.dest?.remove();
        cur.remaining?.remove();
        cur.completed?.remove();
        layerRef.current = { map: null, user: null, dest: null, remaining: null, completed: null };
      }
      if (!map) return;
      if (layerRef.current.map === map) return;

      const completed = L.polyline([], {
        color: "oklch(0.75 0.02 250)",
        weight: 6,
        opacity: 0.55,
        lineCap: "round",
        lineJoin: "round",
        pane: "overlayPane",
        interactive: false,
      }).addTo(map);
      const remaining = L.polyline([], {
        color: "#00A651",
        weight: 8,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
        pane: "overlayPane",
        interactive: false,
      }).addTo(map);
      const dest = L.marker(destination, { icon: destIcon, zIndexOffset: 800 }).addTo(map);
      const user = L.marker([0, 0], {
        icon: makeUserIcon(0),
        zIndexOffset: 3000,
        interactive: false,
        keyboard: false,
        bubblingMouseEvents: false,
        opacity: 0,
      }).addTo(map);

      layerRef.current = { map, user, dest, remaining, completed };
      invalidateSharedMap(50);
    };
    attach(getSharedMap());
    const unsub = subscribeSharedMap(attach);
    return () => {
      unsub();
      const cur = layerRef.current;
      if (markerAnimRef.current) cancelAnimationFrame(markerAnimRef.current);
      cur.user?.remove();
      cur.dest?.remove();
      cur.remaining?.remove();
      cur.completed?.remove();
      layerRef.current = { map: null, user: null, dest: null, remaining: null, completed: null };
    };
  }, [destination]);

  // Update polylines as progress changes
  useEffect(() => {
    const { remaining, completed } = layerRef.current;
    if (!remaining || !completed || !route) return;
    const completedPts = route.geometry.slice(0, Math.max(1, nearestIdx + 1));
    const remainingSlice = route.geometry.slice(nearestIdx);
    const remainingPts = pos
      ? ([pos, ...remainingSlice] as [number, number][])
      : remainingSlice;
    completed.setLatLngs(completedPts.map((p) => L.latLng(p[0], p[1])));
    remaining.setLatLngs(remainingPts.map((p) => L.latLng(p[0], p[1])));
  }, [route, nearestIdx, pos]);

  // Update user marker position + bearing icon
  useEffect(() => {
    const { user, map } = layerRef.current;
    if (!user) return;
    if (!pos) {
      user.setOpacity(0);
      return;
    }
    user.setOpacity(1);
    const start = user.getLatLng();
    const startPoint: [number, number] = Number.isFinite(start.lat) && Number.isFinite(start.lng) && (start.lat !== 0 || start.lng !== 0)
      ? [start.lat, start.lng]
      : pos;
    const startTime = performance.now();
    if (markerAnimRef.current) cancelAnimationFrame(markerAnimRef.current);
    const animateMarker = (now: number) => {
      const t = Math.min(1, (now - startTime) / 450);
      const eased = 1 - Math.pow(1 - t, 3);
      user.setLatLng([
        startPoint[0] + (pos[0] - startPoint[0]) * eased,
        startPoint[1] + (pos[1] - startPoint[1]) * eased,
      ]);
      if (t < 1) markerAnimRef.current = requestAnimationFrame(animateMarker);
    };
    markerAnimRef.current = requestAnimationFrame(animateMarker);
    user.setIcon(makeUserIcon(bearing));
    if (follow && map) {
      map.setView(pos, Math.max(map.getZoom(), 16), { animate: true });
    }
  }, [pos, bearing, follow]);

  // First time we get the route, fit bounds once
  const fittedRef = useRef(false);
  useEffect(() => {
    if (fittedRef.current) return;
    const { map } = layerRef.current;
    if (!map || !route || !pos) return;
    fittedRef.current = true;
    const bounds = L.latLngBounds([pos, ...route.geometry].map((p) => L.latLng(p[0], p[1])));
    map.fitBounds(bounds, { padding: [80, 80], maxZoom: 17 });
  }, [route, pos]);

  void userIcon; // icon is set imperatively above

  return (
    <div className="fixed-ui-overlay">
      {/* RIGHT-CENTER floating controls — single vertical glass stack */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 z-[2000] pointer-events-auto flex flex-col gap-2 rounded-full bg-card/95 backdrop-blur-md border border-border shadow-xl p-1.5">
        <button
          onClick={() => setBearing(0)}
          className="h-10 w-10 grid place-items-center rounded-full hover:bg-secondary transition"
          title="Reset compass"
        >
          <Compass
            className="h-5 w-5 text-primary transition-transform"
            style={{ transform: `rotate(${-bearing}deg)` }}
          />
        </button>
        <button
          onClick={() => {
            setMuted((m) => {
              const next = !m;
              if (next && typeof window !== "undefined" && "speechSynthesis" in window) {
                window.speechSynthesis.cancel();
              }
              return next;
            });
          }}
          className={`h-10 w-10 grid place-items-center rounded-full transition ${muted ? "hover:bg-secondary" : "bg-primary text-primary-foreground hover:opacity-90"}`}
          title={muted ? "Unmute voice" : "Mute voice"}
        >
          {muted ? <VolumeX className="h-5 w-5 text-muted-foreground" /> : <Volume2 className="h-5 w-5" />}
        </button>
        <button
          onClick={() => setFollow(true)}
          className="h-10 w-10 grid place-items-center rounded-full hover:bg-secondary transition"
          title="Recenter on me"
        >
          <LocateFixed className="h-5 w-5 text-primary" />
        </button>
        <button
          onClick={() => {
            setFollow(true);
            if (pos) layerRef.current.map?.setView(pos, Math.max(layerRef.current.map.getZoom(), 16), { animate: true });
          }}
          className="h-10 w-10 grid place-items-center rounded-full hover:bg-secondary transition"
          title="Current location"
        >
          <Crosshair className="h-5 w-5 text-primary" />
        </button>
        <button
          onClick={() => {
            warmUpSpeech();
            const u = createUtterance();
            speak(currentStep?.instruction ?? "Calculating route", u);
          }}
          className="h-10 w-10 grid place-items-center rounded-full hover:bg-secondary transition"
          title="Repeat instruction"
        >
          <Navigation className="h-5 w-5 text-primary" />
        </button>
      </div>

      {/* TOP-LEFT compact navigation panel — outside Leaflet transform panes */}
      <div
        className="absolute left-4 top-[136px] z-[2000] pointer-events-auto w-[320px] max-w-[calc(100vw-2rem)] rounded-[20px] bg-card/95 backdrop-blur-md border border-border shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: "min(55vh, calc(100vh - 264px))" }}
      >
        {/* Top green maneuver card */}
        <div className="bg-gradient-to-br from-[oklch(0.62_0.17_152)] to-[oklch(0.55_0.16_155)] text-white px-4 py-3 flex items-center gap-3">
          <div className="h-12 w-12 shrink-0 rounded-xl bg-white/20 grid place-items-center">
            <ManeuverIcon type={currentStep?.type} modifier={currentStep?.modifier} className="h-7 w-7" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider opacity-85 leading-none">
              {arrived
                ? "Arrived"
                : distToNextManeuver > 0
                  ? `In ${fmtDist(distToNextManeuver)}`
                  : route
                    ? "Now"
                    : "Calculating"}
            </div>
            <div className="text-[15px] font-semibold leading-tight truncate mt-0.5">
              {arrived
                ? "You have arrived"
                : currentStep?.instruction ?? (route ? "Continue straight" : "Loading directions…")}
            </div>
            {currentStep?.name && !arrived && (
              <div className="text-[11px] opacity-80 truncate mt-0.5">on {currentStep.name}</div>
            )}
          </div>
        </div>

        {/* Step list — scrollable */}
        {route && (
          <div ref={stepListRef} className="flex-1 min-h-0 overflow-y-auto divide-y divide-border">
            {route.steps.map((s, i) => {
              const done = i < stepIdx;
              const active = i === stepIdx;
              return (
                <div
                  key={i}
                  data-step={i}
                  className={`flex items-start gap-2.5 px-3 py-2 transition ${
                    active ? "bg-primary/10" : done ? "opacity-45" : ""
                  }`}
                >
                  <div
                    className={`h-8 w-8 shrink-0 rounded-lg grid place-items-center ${
                      active ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
                    }`}
                  >
                    <ManeuverIcon type={s.type} modifier={s.modifier} className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-[12.5px] leading-tight ${active ? "font-semibold" : ""} ${done ? "line-through" : ""}`}>
                      {s.instruction}
                    </div>
                    <div className="text-[10.5px] text-muted-foreground mt-0.5 tabular-nums">
                      {fmtDist(s.distanceM)}
                      {s.name ? ` · ${s.name}` : ""}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* End Trip */}
        <div className="border-t border-border bg-card px-3 py-2.5">
          <button
            onClick={onClose}
            className="w-full inline-flex items-center justify-center gap-1 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold px-2.5 py-2 hover:opacity-90 transition"
            title="End trip"
          >
            <X className="h-3.5 w-3.5" /> End
          </button>
        </div>
      </div>

      {/* BOTTOM-CENTER fixed ETA card */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[2000] pointer-events-auto rounded-2xl bg-foreground/90 text-background backdrop-blur-md border border-foreground/10 shadow-2xl overflow-hidden max-w-[calc(100vw-2rem)]">
        <div className="grid grid-cols-4 divide-x divide-background/15 text-center">
          <div className="px-4 py-3 min-w-[74px]">
            <Gauge className="h-4 w-4 mx-auto mb-1 opacity-80" />
            <div className="text-sm font-bold tabular-nums">{Math.round(speedKmh)}</div>
            <div className="text-[10px] opacity-75">km/h</div>
          </div>
          <div className="px-4 py-3 min-w-[74px]">
            <Clock className="h-4 w-4 mx-auto mb-1 opacity-80" />
            <div className="text-sm font-bold tabular-nums">{route ? Math.max(1, Math.round(remainingDuration / 60)) : "—"}</div>
            <div className="text-[10px] opacity-75">min</div>
          </div>
          <div className="px-4 py-3 min-w-[74px]">
            <Navigation className="h-4 w-4 mx-auto mb-1 opacity-80" />
            <div className="text-sm font-bold tabular-nums">{route ? (remainingDistance / 1000).toFixed(1) : "—"}</div>
            <div className="text-[10px] opacity-75">km</div>
          </div>
          <div className="px-4 py-3 min-w-[74px]">
            <Flag className="h-4 w-4 mx-auto mb-1 opacity-80" />
            <div className="text-sm font-bold tabular-nums">{route ? arrivalTime : "—"}</div>
            <div className="text-[10px] opacity-75">Arrival</div>
          </div>
        </div>
      </div>

      {error && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-destructive text-destructive-foreground px-3 py-1.5 text-xs shadow z-[2001] pointer-events-auto">
          {error}
        </div>
      )}
    </div>
  );
}
