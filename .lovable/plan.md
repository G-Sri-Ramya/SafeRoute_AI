## Goal

Upgrade the existing Voice-Enabled Smart SafeRoute project into a more interactive, "intelligent feeling" navigation experience. No rebuild — only targeted edits to 3 files: `RouteMap.tsx`, `SafeRouteApp.tsx`, and `voice.ts`.

## Files to change

1. `src/components/RouteMap.tsx`
2. `src/components/SafeRouteApp.tsx`
3. `src/lib/voice.ts`

No new dependencies, no schema changes, no server function changes (route generation already produces 5 distinct curved polylines on both sides of the straight line, so multi-route rendering is already correct — we just need the interactivity layer).

---

## 1. Interactive route selection (the headline change)

**State** — add to `SafeRouteApp`:
- `selectedRouteId: string | null` (defaults to `best.id` whenever a new `result` arrives, via `useEffect`).
- Pass `selectedId` and `onSelect` down to `<RouteMap>`.
- Pass `selected`/`onClick` to each `<RouteRow>` card.

**RouteMap.tsx changes**:
- Accept new props: `selectedId?: string`, `onSelect?: (id: string) => void`.
- For each `<Polyline>`, compute style based on whether it's selected:
  - Selected: `weight: 8`, `opacity: 1`, color = bright green (`oklch(0.72 0.2 152)`), no dash, raised z via `pane` or rendered last.
  - Others (when something is selected): `weight: 3`, `opacity: 0.35`, color = neutral gray (`oklch(0.7 0.02 250)`), `dashArray: "6 8"`.
  - When nothing is selected, keep the current score-color styling so the empty state still reads.
- Add `eventHandlers={{ click: () => onSelect?.(r.id) }}` to each polyline so map clicks also select.
- Render the selected polyline LAST (sort routes so selected is last in the map array) so it draws on top.
- Replace `FitBounds` with `FocusBounds` that fits to the **selected route's path** (with `[80,80]` padding) when `selectedId` changes, and fits to all routes on first load. Use `flyToBounds` for a smooth recenter animation.

**Card interactivity in `SafeRouteApp` (RouteRow)**:
- On hover: add `hover:-translate-y-0.5 hover:shadow-card hover:border-primary/40 transition` (Tailwind only — no new CSS).
- On click: call `onSelect(r.id)`; when `selected`, apply `ring-2 ring-primary border-primary bg-primary/10`.
- Add `cursor-pointer` and `role="button"` + keyboard `onKeyDown` (Enter/Space) for accessibility.

## 2. Recommended route emphasis

In the "All routes" list, the first route (highest score = `best`) gets:
- A small `⭐ Recommended` chip in the top-right of the card.
- Slightly larger padding (`p-4` vs `p-3`) and a stronger border (`border-primary/60 shadow-glow`).
- Always pinned to the top (already sorted by score server-side).

## 3. "Why this route?" — dynamic explainable AI block

Move/duplicate the explanation block so it reflects the **selected** route, not just `best`. Build the explanation dynamically from the selected route's data:

```text
Why this route?
• {Low | Moderate | Heavy} traffic right now
• {Good | Moderate | Poor} road condition
• {No waterlogging | Waterlogging reported on segment}
• {ETA} min over {distance} km
```

Render as a bulleted list with the existing `Sparkles` icon header. Source the bullets from `selected.traffic`, `selected.road`, `selected.waterlogging`, `selected.etaMin`, `selected.distanceKm`.

## 4. Route comparison insight

Compute the fastest route (`min(etaMin)`) and the safest route (already `best`). If they differ, render a small amber callout under the recommended card:

> ⚠️ A faster route ({fastest.name}, {fastest.etaMin} min) exists but scores {fastest.totalScore}/15 vs {best.totalScore}/15. We chose safety over speed.

Use existing `AlertTriangle` icon and `var(--moderate)` styling — no new tokens.

## 5. Voice integration polish

`SafeRouteApp` mic button states (visual feedback only — logic already works):
- Idle: mic icon.
- `listening = true`: red pulsing ring + label "Listening…" shown under the search box.
- After transcript received but before result: label "Processing…" shown until `loading` flips false.

Add a new `voicePhase` state: `"idle" | "listening" | "processing"`.
- Set to `"listening"` in `startListening`.
- Set to `"processing"` in the `onresult` handler right before `runEvaluate`.
- Reset to `"idle"` in `runEvaluate`'s `finally`.

`voice.ts` — small robustness fix:
- In `getSpeechRecognition`, set `rec.continuous = false` explicitly and add `rec.interimResults = false` (already set) — and return a fresh instance per call (already does).
- Broaden `parseFromTo` regex to also accept "to X from Y" word order and strip filler like "please", "could you".

## 6. Header line: "Routes from X → Y"

Above the "All routes" list, add a one-line header sourced from `result.fromLabel → result.toLabel` (already returned by the server). Truncate with `line-clamp-1` and a tooltip (`title={...}`) for long names. Updates automatically for both manual and voice input because both paths go through `runEvaluate`.

## 7. Loading state polish

Replace the existing top-of-map "Analyzing routes…" pill with a centered card containing:
- A spinning `Navigation` icon (use `animate-spin`).
- Text: "Analyzing safest routes…"
- A subtle skeleton row in the sidebar where the result cards will appear.

## 8. Stability / debug

- `RouteMap` already lazy-loads; ensure the Suspense fallback renders even when `result` is null is fine (it only mounts after result, so no fallback flash). No change required, but verify by reading `SafeRouteApp` — the current `{result ? <Suspense>…</Suspense> : <empty state/>}` pattern is correct.
- Guard `runEvaluate` so empty/whitespace inputs short-circuit before hitting the server (already done).
- Wrap the `rec.start()` call in try/catch (already done).
- Add `aria-live="polite"` to the voice phase indicator and the toast so screen readers announce them.

---

## Out of scope (intentionally not changing)

- Server function logic, route generation, scoring formulas.
- Theme/colors (TSRTC green look stays).
- Sidebar layout (left panel + right map stays).
- Reporting flow (already works).

## Acceptance check after implementation

1. Run a search → 5 polylines visible on map, recommended highlighted.
2. Click any card → that polyline becomes thick green, others fade gray, map flies to fit the selected route, "Why this route?" updates.
3. Click a polyline on the map → same selection updates the sidebar card.
4. Mic button → shows "Listening…", then "Processing…", then result + voice readout.
5. Header above route list reads "Routes from {source} → {destination}".
6. When a faster-but-less-safe route exists, the amber comparison note appears.
