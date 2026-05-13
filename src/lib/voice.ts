// Tiny wrapper around the Web Speech API.
// Falls back gracefully if APIs are missing.

export interface VoiceHookState {
  supported: boolean;
  listening: boolean;
}

type SR = any;

export function getSpeechRecognition(): SR | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.continuous = false;
  return rec;
}

// Pick a sensible English voice once voices are loaded.
function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined") return null;
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  if (!voices.length) return null;
  return (
    voices.find((v) => /en[-_](US|GB|IN)/i.test(v.lang) && /female|samantha|google/i.test(v.name)) ||
    voices.find((v) => /^en/i.test(v.lang)) ||
    voices[0]
  );
}

// Some browsers (Safari/iOS) require a warm-up utterance triggered by a user gesture
// before any subsequent speak() works. Call this from a click handler once.
let warmedUp = false;
export function warmUpSpeech() {
  if (typeof window === "undefined") return;
  const synth = window.speechSynthesis;
  if (!synth || warmedUp) return;
  try {
    const u = new SpeechSynthesisUtterance("");
    u.volume = 0;
    synth.speak(u);
    warmedUp = true;
  } catch {
    /* noop */
  }
}

/**
 * Speak text. To work reliably across browsers (esp. Safari/iOS) the
 * SpeechSynthesisUtterance MUST be created inside a user gesture. Pass a
 * pre-created utterance from your click handler and we'll fill in `.text`
 * before calling speak() — even after async work.
 */
export function speak(text: string, prepared?: SpeechSynthesisUtterance) {
  if (typeof window === "undefined") return;
  const synth = window.speechSynthesis;
  if (!synth) return;
  try {
    synth.cancel();
    const utter = prepared ?? new SpeechSynthesisUtterance();
    utter.text = text;
    utter.lang = utter.lang || "en-US";
    utter.rate = 1;
    utter.pitch = 1;
    utter.volume = 1;
    const v = pickVoice();
    if (v) utter.voice = v;
    synth.speak(utter);
  } catch (e) {
    console.error("speak() failed", e);
  }
}

/** Create an utterance synchronously inside a user gesture; fill text later. */
export function createUtterance(): SpeechSynthesisUtterance | undefined {
  if (typeof window === "undefined") return undefined;
  if (!window.speechSynthesis) return undefined;
  const u = new SpeechSynthesisUtterance("");
  u.lang = "en-US";
  u.rate = 1;
  u.pitch = 1;
  u.volume = 1;
  return u;
}

// Parse "navigate from X to Y" / "from X to Y" / "X to Y" patterns.
export function parseFromTo(transcript: string): { from?: string; to?: string } {
  const clean = (s: string) =>
    s
      .trim()
      .replace(/[.?!,]+$/g, "")
      .replace(/\s+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  let t = transcript
    .trim()
    .replace(/\b(please|could you|can you|kindly|hey|hi|hello)\b/gi, "")
    .replace(/^(navigate|go|take me|route|directions?|find|show)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  // "from X to Y" / "X to Y"
  let m = t.match(/(?:from\s+)?(.+?)\s+to\s+(.+)/i);
  if (m) return { from: clean(m[1]), to: clean(m[2]) };
  // "to Y from X"
  m = t.match(/to\s+(.+?)\s+from\s+(.+)/i);
  if (m) return { from: clean(m[2]), to: clean(m[1]) };
  return {};
}
