// Client-side geocoding helpers using OpenStreetMap Nominatim.
// No API key required. Be polite — debounce on the caller side.

export interface PlaceSuggestion {
  label: string;       // short display: "Sampradaya Sweets, KPHB"
  fullLabel: string;   // full display_name
  lat: number;
  lng: number;
}

const UA_HEADERS: HeadersInit = {
  Accept: "application/json",
};

function shorten(displayName: string): string {
  const parts = displayName.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 2) return displayName;
  return `${parts[0]}, ${parts[1]}`;
}

export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  // countrycodes=in biases toward India where the demo is focused, but still
  // allows global matches when users include a country in their query.
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=0&limit=6&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, { headers: UA_HEADERS, signal });
    if (!res.ok) return [];
    const json = (await res.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
    }>;
    return json.map((j) => ({
      label: shorten(j.display_name),
      fullLabel: j.display_name,
      lat: parseFloat(j.lat),
      lng: parseFloat(j.lon),
    }));
  } catch {
    return [];
  }
}

export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16`;
  try {
    const res = await fetch(url, { headers: UA_HEADERS });
    if (!res.ok) return null;
    const json = (await res.json()) as { display_name?: string };
    return json.display_name ? shorten(json.display_name) : null;
  } catch {
    return null;
  }
}

export function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation not supported in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000,
    });
  });
}
