import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { useServerFn } from "@tanstack/react-start";
import { evaluateRoutes, reportIssue } from "@/server/routes.functions";
import type { EvaluateResponse, RouteOption } from "@/data/routes";
import { getSpeechRecognition, parseFromTo, speak, createUtterance, warmUpSpeech } from "@/lib/voice";
import { Mic, MicOff, Volume2, AlertTriangle, Droplets, Construction, Ban, Sparkles, Navigation, Clock, Route as RouteIcon, MapPin, Bus, Star, Zap, LocateFixed, PanelLeftOpen } from "lucide-react";
import { PlaceAutocomplete } from "./PlaceAutocomplete";
import { getCurrentPosition, reverseGeocode } from "@/lib/geocode";
import { invalidateSharedMap } from "@/lib/mapRef";

// Map is client-only (Leaflet needs window)
const RouteMap = lazy(() => import("./RouteMap").then((m) => ({ default: m.RouteMap })));
const NavigationView = lazy(() =>
  import("./NavigationView").then((m) => ({ default: m.NavigationView })),
);

const PRESETS = [
  { from: "Ameerpet, Hyderabad", to: "Kukatpally, Hyderabad" },
  { from: "Connaught Place, Delhi", to: "India Gate, Delhi" },
  { from: "Bandra, Mumbai", to: "Andheri, Mumbai" },
];

const SUGGESTIONS = [
  "Ameerpet, Hyderabad",
  "Kukatpally, Hyderabad",
  "Madhapur, Hyderabad",
  "Hitech City, Hyderabad",
  "Gachibowli, Hyderabad",
  "Secunderabad, Hyderabad",
  "Banjara Hills, Hyderabad",
  "Jubilee Hills, Hyderabad",
  "Begumpet, Hyderabad",
  "KPHB, Hyderabad",
  "Miyapur, Hyderabad",
  "LB Nagar, Hyderabad",
  "Dilsukhnagar, Hyderabad",
  "Charminar, Hyderabad",
  "Mehdipatnam, Hyderabad",
  "Uppal, Hyderabad",
];

function ScoreBar({ label, value, max = 5 }: { label: string; value: number; max?: number }) {
  const pct = (value / max) * 100;
  const color = value >= 4 ? "bg-[var(--safe)]" : value >= 2.5 ? "bg-[var(--moderate)]" : "bg-[var(--risky)]";
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
        <span>{label}</span>
        <span className="font-mono text-foreground">{value}/{max}</span>
      </div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "safe" | "warn" | "risk" | "default" }) {
  const tones = {
    safe: "bg-[var(--safe)]/15 text-[var(--safe)] border-[var(--safe)]/30",
    warn: "bg-[var(--moderate)]/15 text-[var(--moderate)] border-[var(--moderate)]/30",
    risk: "bg-[var(--risky)]/15 text-[var(--risky)] border-[var(--risky)]/30",
    default: "bg-secondary text-secondary-foreground border-border",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function SafeRouteApp() {
  const evalFn = useServerFn(evaluateRoutes);
  const reportFn = useServerFn(reportIssue);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reportKey, setReportKey] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EvaluateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState<string>("");
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [voicePhase, setVoicePhase] = useState<"idle" | "listening" | "processing">("idle");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [locating, setLocating] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const recRef = useRef<any>(null);
  const lastNarratedRef = useRef<string | null>(null);

  useEffect(() => {
    setVoiceSupported(!!getSpeechRecognition());
  }, []);

  // When new results arrive, default selection to the recommended (best) route.
  useEffect(() => {
    if (result?.best) {
      setSelectedId(result.best.id);
      // The initial spokenSummary already plays for best on evaluate; mark it
      // as narrated so the selection effect doesn't double-speak.
      lastNarratedRef.current = result.best.id;
    }
  }, [result]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(id);
  }, [toast]);

  // Whenever the sidebar opens/closes or navigation mode toggles, the map
  // container changes size — Leaflet needs invalidateSize() or it renders
  // half-blank tiles.
  useEffect(() => {
    invalidateSharedMap(320);
  }, [sidebarOpen, navigating, result]);

  async function runEvaluate(f = from, t = to, utter?: SpeechSynthesisUtterance) {
    if (!f.trim() || !t.trim()) {
      setError("Enter both source and destination.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await evalFn({ data: { from: f, to: t } });
      if ("error" in res) {
        setError(res.error);
        speak(res.error, utter);
      } else {
        setResult(res);
        setReportKey(`${f.trim().toLowerCase()}->${t.trim().toLowerCase()}`);
        speak(res.spokenSummary, utter);
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to evaluate routes");
    } finally {
      setLoading(false);
      setVoicePhase("idle");
    }
  }

  function startListening() {
    warmUpSpeech();
    const rec = getSpeechRecognition();
    if (!rec) {
      setVoiceSupported(false);
      return;
    }
    // Pre-create utterance inside the click gesture so speak() works after async work.
    const utter = createUtterance();
    recRef.current = rec;
    setListening(true);
    setVoicePhase("listening");
    setTranscript("");
    rec.onresult = (ev: any) => {
      const text = ev.results[0][0].transcript as string;
      setTranscript(text);
      const parsed = parseFromTo(text);
      if (parsed.from && parsed.to) {
        setVoicePhase("processing");
        const isHere = (s: string) => /^(my\s+location|current\s+location|here)$/i.test(s.trim());
        (async () => {
          let f = parsed.from!;
          let t = parsed.to!;
          try {
            if (isHere(f)) f = (await resolveCurrentLocationLabel()) ?? f;
            if (isHere(t)) t = (await resolveCurrentLocationLabel()) ?? t;
          } catch {
            /* fall through with raw text */
          }
          setFrom(f);
          setTo(t);
          runEvaluate(f, t, utter);
        })();
      } else {
        setError("Couldn't parse. Try: 'Navigate from <place> to <place>'.");
        speak("Sorry, please say from a place to another place.", utter);
        setVoicePhase("idle");
      }
    };
    rec.onerror = (e: any) => {
      console.error("Speech recognition error", e);
      setListening(false);
      setVoicePhase("idle");
      setError(`Mic error: ${e?.error ?? "unknown"}. Allow microphone access.`);
    };
    rec.onend = () => setListening(false);
    try {
      rec.start();
    } catch (e) {
      console.error(e);
      setListening(false);
      setVoicePhase("idle");
    }
  }

  async function resolveCurrentLocationLabel(): Promise<string | null> {
    const pos = await getCurrentPosition();
    const label = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
    return label ?? `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
  }

  async function useMyLocation() {
    setLocating(true);
    setError(null);
    try {
      const label = await resolveCurrentLocationLabel();
      if (label) {
        setFrom(label);
        setToast("Current location detected");
      } else {
        setError("Could not resolve your location.");
      }
    } catch (e: any) {
      setError(e?.message ?? "Location permission denied.");
    } finally {
      setLocating(false);
    }
  }

  function stopListening() {
    recRef.current?.stop?.();
    setListening(false);
    setVoicePhase((p) => (p === "listening" ? "idle" : p));
  }

  async function submitReport(routeId: string, type: "pothole" | "waterlogging" | "blocked") {
    try {
      await reportFn({ data: { reportKey, routeId, type } });
      setToast(`Reported ${type}. Recalculating…`);
      setReportOpen(false);
      await runEvaluate();
    } catch {
      setToast("Failed to report");
    }
  }

  const best = result?.best;
  const selected = result?.routes.find((r) => r.id === selectedId) ?? best;
  const fastest = result?.routes.reduce<RouteOption | null>(
    (acc, r) => (!acc || r.etaMin < acc.etaMin ? r : acc),
    null,
  );
  const showComparison =
    !!best && !!fastest && fastest.id !== best.id && fastest.etaMin < best.etaMin;

  function whyBullets(r: RouteOption): string[] {
    const traffic =
      r.traffic === "low"
        ? "Low traffic right now"
        : r.traffic === "medium"
          ? "Moderate traffic right now"
          : "Heavy traffic right now";
    const road =
      r.road === "good"
        ? "Good road condition"
        : r.road === "moderate"
          ? "Moderate road condition"
          : "Poor road condition";
    const water = r.waterlogging
      ? "Waterlogging reported on this segment"
      : "No waterlogging reported";
    return [traffic, road, water, `${r.etaMin} min over ${r.distanceKm.toFixed(1)} km`];
  }

  // Build a longer, spoken-style narration covering route name, ETA, distance,
  // full safety breakdown, reasons, and a comparison vs. the safest/fastest.
  function buildNarration(r: RouteOption): string {
    if (!result) return "";
    const isBest = best && r.id === best.id;
    const trafficSentence =
      r.traffic === "low"
        ? "Traffic is light, giving a smooth flow."
        : r.traffic === "medium"
          ? "Traffic is moderate, expect some slowdowns."
          : "Traffic is heavy, expect delays and frequent stops.";
    const roadSentence =
      r.road === "good"
        ? "Road condition is good with smooth surfaces."
        : r.road === "moderate"
          ? "Road condition is moderate, with occasional rough patches."
          : "Road condition is poor, with potholes or uneven surface.";
    const waterSentence = r.waterlogging
      ? "Waterlogging has been reported on this segment, so ride with caution."
      : "No waterlogging reported, drainage looks clear.";
    const intro = isBest
      ? `${r.name} is the recommended safest route.`
      : `You selected ${r.name}.`;
    const eta = `It is about ${r.distanceKm.toFixed(1)} kilometers and takes around ${r.etaMin} minutes.`;
    let comparison = "";
    if (!isBest && best) {
      comparison = ` The recommended ${best.name} is considered safer overall.`;
    } else if (isBest && fastest && fastest.id !== best?.id) {
      comparison = ` A faster option, ${fastest.name}, takes ${fastest.etaMin} minutes, but it has worse conditions, so we are choosing safety over speed.`;
    }
    return `${intro} ${eta} ${trafficSentence} ${roadSentence} ${waterSentence}${comparison}`;
  }

  // Auto-narrate whenever the user picks a different route from the
  // recommendation. We skip the very first selection (it's the best route,
  // already announced via spokenSummary on evaluate).
  useEffect(() => {
    if (!result || !selected) return;
    if (lastNarratedRef.current === selected.id) return;
    lastNarratedRef.current = selected.id;
    speak(buildNarration(selected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, result]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground flex flex-col md:flex-row">
      {/* LEFT SIDEBAR — search, voice, results, reports (scrollable, always available) */}
      <aside
        className={`${
          sidebarOpen ? "w-full md:w-[400px] md:h-full h-[55vh]" : "hidden"
        } shrink-0 border-b md:border-b-0 md:border-r border-border bg-card flex flex-col`}
      >
        {/* Gamyam-style green brand header */}
        <div className="bg-gradient-hero text-primary-foreground px-4 py-3 flex items-center justify-between gap-2 shadow-card">
          <div className="flex items-center gap-2.5">
            <div className="relative h-10 w-10 rounded-xl bg-white grid place-items-center shadow-card">
              <Bus className="h-5 w-5 text-primary" />
              <MapPin className="absolute -top-1.5 -right-1.5 h-4 w-4 text-[var(--accent)] fill-[var(--accent)]" strokeWidth={2.5} />
            </div>
            <div className="leading-tight">
              <div className="text-base font-bold tracking-tight">SafeRoute</div>
              <div className="text-[10px] opacity-90 font-medium">Plan · Ride · Arrive Safely</div>
            </div>
          </div>
          {result && (
            <div className="flex items-center gap-1.5 rounded-full bg-white/20 backdrop-blur px-2.5 py-1 text-[10px] font-medium">
              <Clock className="h-3 w-3" />
              <span className="capitalize">{result.timeOfDay}</span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Search card */}
          <div className="bg-card border border-border rounded-2xl shadow-card p-4 animate-fade-in-up">
            <div className="flex items-center gap-2 mb-3">
              <RouteIcon className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Plan a safe route</h3>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">From</label>
                <button
                  type="button"
                  onClick={useMyLocation}
                  disabled={locating}
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline disabled:opacity-60"
                  title="Use my current location"
                >
                  <LocateFixed className={`h-3 w-3 ${locating ? "animate-pulse" : ""}`} />
                  {locating ? "Locating…" : "Use current location"}
                </button>
              </div>
              <PlaceAutocomplete
                value={from}
                onChange={setFrom}
                placeholder="Search any place, shop, or street"
              />
              <label className="text-xs text-muted-foreground mt-1">To</label>
              <PlaceAutocomplete
                value={to}
                onChange={setTo}
                placeholder="e.g. Sampradaya Sweets, KPHB 9th Phase"
              />
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => { warmUpSpeech(); runEvaluate(from, to, createUtterance()); }}
                disabled={loading}
                className="flex-1 rounded-lg bg-primary text-primary-foreground font-semibold py-2.5 text-sm shadow-glow hover:opacity-90 transition disabled:opacity-60"
              >
                {loading ? "Analyzing routes…" : "Find safest route"}
              </button>
              <button
                onClick={listening ? stopListening : startListening}
                disabled={!voiceSupported}
                title={voiceSupported ? "Say: 'Navigate from X to Y'" : "Voice not supported"}
                className={`relative h-10 w-10 grid place-items-center rounded-lg border border-border bg-secondary hover:bg-secondary/70 transition ${listening ? "animate-pulse-ring" : ""} disabled:opacity-50`}
              >
                {listening ? <MicOff className="h-4 w-4 text-primary" /> : <Mic className="h-4 w-4 text-primary" />}
              </button>
            </div>

            {transcript && (
              <p className="mt-2 text-xs text-muted-foreground italic">"{transcript}"</p>
            )}

            {(voicePhase !== "idle" || (loading && transcript)) && (
              <div
                aria-live="polite"
                className="mt-2 flex items-center gap-2 text-xs text-primary"
              >
                <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" />
                {voicePhase === "listening" ? "Listening…" : "Processing…"}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={`${p.from}-${p.to}`}
                  onClick={() => { warmUpSpeech(); setFrom(p.from); setTo(p.to); runEvaluate(p.from, p.to, createUtterance()); }}
                  className="text-xs rounded-full bg-secondary border border-border px-2.5 py-1 hover:bg-secondary/70"
                >
                  {p.from.split(",")[0]} → {p.to.split(",")[0]}
                </button>
              ))}
            </div>

            {error && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 p-2 text-xs text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Best route card */}
          {best && (
            <div className="bg-card border-2 border-primary/60 rounded-2xl shadow-glow p-4 animate-fade-in-up">
              <div className="flex items-center justify-between mb-1">
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-primary font-semibold">
                  <Star className="h-3 w-3 fill-primary text-primary" /> Recommended
                </span>
                <Badge tone={best.totalScore >= 12 ? "safe" : best.totalScore >= 8 ? "warn" : "risk"}>
                  Safety {best.totalScore}/15
                </Badge>
              </div>
              <h3 className="text-base font-semibold leading-tight">{best.name}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{best.from} → {best.to} · {best.etaMin} min · {best.distanceKm.toFixed(1)} km</p>

              <div className="mt-3 grid gap-2">
                <ScoreBar label="Traffic" value={best.trafficScore} />
                <ScoreBar label="Road condition" value={best.roadScore} />
                <ScoreBar label="Drainage / water" value={best.waterScore} />
              </div>

              {selected && (
                <div className="mt-3 rounded-lg bg-secondary/60 border border-border p-2.5">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                    <Sparkles className="h-3 w-3" /> Why this route?
                  </div>
                  <ul className="text-xs leading-relaxed space-y-1">
                    {whyBullets(selected).map((b, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-primary mt-0.5">•</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                  {selected.id !== best.id && (
                    <p className="mt-2 text-[10px] text-muted-foreground italic">
                      Showing details for selected route ({selected.name}).
                    </p>
                  )}
                </div>
              )}

              {showComparison && (
                <div className="mt-2 flex items-start gap-2 rounded-lg bg-[var(--moderate)]/10 border border-[var(--moderate)]/30 p-2 text-[11px] leading-relaxed text-foreground">
                  <Zap className="h-3.5 w-3.5 text-[var(--moderate)] mt-0.5 shrink-0" />
                  <span>
                    A faster route exists (<span className="font-medium">{fastest!.name}</span>, {fastest!.etaMin} min) but scores {fastest!.totalScore}/15 vs {best.totalScore}/15. We chose safety over speed.
                  </span>
                </div>
              )}

              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => {
                    warmUpSpeech();
                    setNavigating(true);
                    setSidebarOpen(false);
                    invalidateSharedMap(300);
                  }}
                  className="flex items-center gap-1.5 text-xs rounded-lg bg-primary text-primary-foreground font-semibold px-3 py-1.5 shadow-glow hover:opacity-90"
                >
                  <Navigation className="h-3.5 w-3.5" /> Start navigation
                </button>
                <button
                  onClick={() => {
                    warmUpSpeech();
                    const u = createUtterance();
                    speak(selected ? buildNarration(selected) : result!.spokenSummary, u);
                  }}
                  className="flex items-center gap-1.5 text-xs rounded-lg border border-border bg-secondary px-2.5 py-1.5 hover:bg-secondary/70"
                >
                  <Volume2 className="h-3.5 w-3.5 text-primary" /> Narrate details
                </button>
                <button
                  onClick={() => setReportOpen((v) => !v)}
                  className="flex items-center gap-1.5 text-xs rounded-lg border border-border bg-secondary px-2.5 py-1.5 hover:bg-secondary/70"
                >
                  <AlertTriangle className="h-3.5 w-3.5 text-[var(--moderate)]" /> Report issue
                </button>
              </div>

              {reportOpen && (
                <div className="mt-2 grid grid-cols-3 gap-1.5 animate-fade-in-up">
                  <button onClick={() => submitReport(best.id, "pothole")} className="flex flex-col items-center gap-1 rounded-lg border border-border bg-background/40 p-2 text-xs hover:bg-secondary">
                    <Construction className="h-4 w-4 text-[var(--moderate)]" /> Pothole
                  </button>
                  <button onClick={() => submitReport(best.id, "waterlogging")} className="flex flex-col items-center gap-1 rounded-lg border border-border bg-background/40 p-2 text-xs hover:bg-secondary">
                    <Droplets className="h-4 w-4 text-primary" /> Water
                  </button>
                  <button onClick={() => submitReport(best.id, "blocked")} className="flex flex-col items-center gap-1 rounded-lg border border-border bg-background/40 p-2 text-xs hover:bg-secondary">
                    <Ban className="h-4 w-4 text-[var(--risky)]" /> Blocked
                  </button>
                </div>
              )}
            </div>
          )}

          {/* All routes list */}
          {result && (
            <div className="bg-card border border-border rounded-2xl shadow-card p-4">
              <div className="mb-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <RouteIcon className="h-4 w-4 text-primary" /> All routes
                </h4>
                <p
                  className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1"
                  title={`${result.fromLabel} → ${result.toLabel}`}
                >
                  Routes from <span className="text-foreground font-medium">{result.fromLabel}</span> → <span className="text-foreground font-medium">{result.toLabel}</span>
                </p>
              </div>
              <ul className="space-y-2">
                {result.routes.map((r, i) => (
                  <RouteRow
                    key={r.id}
                    r={r}
                    rank={i + 1}
                    isBest={r.id === best?.id}
                    isSelected={r.id === selectedId}
                    onSelect={() => setSelectedId(r.id)}
                  />
                ))}
              </ul>
              <div className="mt-4 pt-3 border-t border-border text-[11px] text-muted-foreground leading-relaxed">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[var(--safe)]" /> Safe (12–15)</span>
                  <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[var(--moderate)]" /> Moderate (8–11)</span>
                  <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[var(--risky)]" /> Risky (&lt;8)</span>
                </div>
                Scores combine traffic, road condition, and waterlogging — adjusted by time of day and live user reports.
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* RIGHT — Map panel */}
      <main className="map-wrapper relative flex-1 min-h-0 overflow-hidden">
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute top-[88px] left-3 z-[1100] inline-flex items-center gap-1.5 rounded-full bg-card/95 backdrop-blur border border-border shadow-card px-3 py-1.5 text-xs font-semibold text-primary hover:bg-secondary transition"
            title="Open SafeRoute panel"
          >
            <PanelLeftOpen className="h-4 w-4" /> Open
          </button>
        )}
        {result ? (
          <Suspense fallback={<div className="h-full w-full grid place-items-center text-muted-foreground">Loading map…</div>}>
            <RouteMap
              routes={result.routes}
              bestId={best?.id}
              selectedId={selectedId ?? undefined}
              navigationMode={navigating}
              onSelect={(id) => setSelectedId(id)}
            />
          </Suspense>
        ) : (
          <div className="h-full w-full grid place-items-center text-muted-foreground bg-secondary/20">
            <div className="text-center max-w-md px-6">
              <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-gradient-hero shadow-glow grid place-items-center">
                <Navigation className="h-7 w-7 text-primary-foreground" />
              </div>
              <h2 className="text-2xl font-semibold text-foreground mb-2">Voice-Enabled Smart SafeRoute</h2>
              <p className="text-sm">
                Search any source and destination on the left. We'll generate 3 routes and recommend the safest using multi-factor decision modeling.
              </p>
            </div>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 z-30 grid place-items-center bg-background/40 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-card border border-border px-6 py-5 shadow-glow">
              <Navigation className="h-7 w-7 text-primary animate-spin" />
              <span className="text-sm font-medium">Analyzing safest routes…</span>
              <span className="text-[11px] text-muted-foreground">Scoring traffic, road & water</span>
            </div>
          </div>
        )}

        {toast && (
          <div className="absolute z-40 bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-card border border-border px-4 py-2 text-sm shadow-card animate-fade-in-up">
            {toast}
          </div>
        )}

        {navigating && selected && (
          <Suspense fallback={<div className="absolute inset-0 z-50 grid place-items-center bg-background">Loading navigation…</div>}>
            <NavigationView
              destination={selected.path[selected.path.length - 1]}
              destLabel={result?.toLabel ?? selected.to}
              onClose={() => {
                setNavigating(false);
                setSidebarOpen(true);
                invalidateSharedMap(300);
              }}
            />
          </Suspense>
        )}
      </main>
    </div>
  );
}

function RouteRow({
  r,
  rank,
  isBest,
  isSelected,
  onSelect,
}: {
  r: RouteOption;
  rank: number;
  isBest: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const tone = r.totalScore >= 12 ? "safe" : r.totalScore >= 8 ? "warn" : "risk";
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`cursor-pointer rounded-xl border p-3 transition-all hover:-translate-y-0.5 hover:shadow-card hover:border-primary/40 ${
        isSelected
          ? "ring-2 ring-primary border-primary bg-primary/10 shadow-card"
          : isBest
            ? "border-primary/50 bg-primary/5"
            : "border-border bg-background/30"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-muted-foreground">#{rank}</span>
          <span className="text-sm font-medium">{r.name}</span>
          {isBest && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">
              <Star className="h-2.5 w-2.5 fill-primary text-primary" /> Rec
            </span>
          )}
        </div>
        <Badge tone={tone}>{r.totalScore}/15</Badge>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {r.etaMin} min · {r.distanceKm.toFixed(1)} km
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <Badge tone={r.traffic === "low" ? "safe" : r.traffic === "medium" ? "warn" : "risk"}>{r.traffic} traffic</Badge>
        <Badge tone={r.road === "good" ? "safe" : r.road === "moderate" ? "warn" : "risk"}>{r.road} road</Badge>
        <Badge tone={r.waterlogging ? "risk" : "safe"}>{r.waterlogging ? "water" : "dry"}</Badge>
      </div>
    </li>
  );
}
