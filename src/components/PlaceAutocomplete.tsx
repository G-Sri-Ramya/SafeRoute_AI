import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { searchPlaces, type PlaceSuggestion } from "@/lib/geocode";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onPick?: (s: PlaceSuggestion) => void;
  placeholder?: string;
  id?: string;
}

// Debounced live autocomplete using OpenStreetMap Nominatim. Shows a
// dropdown of real-world matches (shops, streets, areas, landmarks).
export function PlaceAutocomplete({ value, onChange, onPick, placeholder, id }: Props) {
  const [items, setItems] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const justPickedRef = useRef(false);

  useEffect(() => {
    if (justPickedRef.current) {
      justPickedRef.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 3) {
      setItems([]);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      const res = await searchPlaces(q, ctrl.signal);
      setItems(res);
      setLoading(false);
      setOpen(true);
      setActive(-1);
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
      setLoading(false);
    };
  }, [value]);

  // Close dropdown on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(s: PlaceSuggestion) {
    justPickedRef.current = true;
    onChange(s.label);
    onPick?.(s);
    setOpen(false);
    setItems([]);
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => items.length && setOpen(true)}
        onKeyDown={(e) => {
          if (!open || items.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(items.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            pick(items[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      {loading && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
          …
        </span>
      )}
      {open && items.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-border bg-popover shadow-card text-sm">
          {items.map((s, i) => (
            <li
              key={`${s.lat},${s.lng},${i}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              className={`flex items-start gap-2 px-3 py-2 cursor-pointer ${
                i === active ? "bg-secondary" : "hover:bg-secondary/60"
              }`}
            >
              <MapPin className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
              <div className="leading-tight">
                <div className="text-foreground">{s.label}</div>
                <div className="text-[10px] text-muted-foreground line-clamp-1">
                  {s.fullLabel}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
