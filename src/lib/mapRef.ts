// Tiny module-level singleton so non-child components (e.g. NavigationView,
// which is rendered as a floating overlay outside the MapContainer tree) can
// reach the SAME Leaflet map instance created inside RouteMap. This lets us
// keep exactly ONE <MapContainer> in the app and still attach navigation
// markers / polylines / setView calls to it imperatively.

import type { Map as LeafletMap } from "leaflet";

let _map: LeafletMap | null = null;
const subs = new Set<(m: LeafletMap | null) => void>();

export function setSharedMap(m: LeafletMap | null) {
  _map = m;
  subs.forEach((s) => s(m));
}

export function getSharedMap(): LeafletMap | null {
  return _map;
}

export function subscribeSharedMap(cb: (m: LeafletMap | null) => void) {
  subs.add(cb);
  if (_map) cb(_map);
  return () => subs.delete(cb);
}

/** Ask Leaflet to recompute container size after a layout change. */
export function invalidateSharedMap(delayMs = 300) {
  setTimeout(() => {
    try {
      _map?.invalidateSize({ animate: false });
    } catch {
      /* noop */
    }
  }, delayMs);
}
