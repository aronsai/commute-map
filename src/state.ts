import type { Apartment, Results, SavedState } from "./types";
import { resultKey } from "./types";
import { nextWeekday } from "./time";
export const storageKey = "hemvag:v1";
export const initialState = (): SavedState => ({
  version: 1,
  apartments: [],
  settings: {
    people: [
      { id: "you", name: "You", work: null, arrival: "09:00" },
      { id: "partner", name: "Partner", work: null, arrival: "09:00" },
    ],
    date: nextWeekday(),
    mode: "transit",
    daycare: { enabled: false, location: null, personId: "you", minutes: 5 },
  },
});
function validLocation(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.label === "string" &&
    typeof p.lat === "number" &&
    Number.isFinite(p.lat) &&
    Math.abs(p.lat) <= 90 &&
    typeof p.lng === "number" &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lng) <= 180 &&
    (p.slId === undefined || typeof p.slId === "string")
  );
}
export function loadState(): { state: SavedState; warning: string } {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { state: initialState(), warning: "" };
    const s = JSON.parse(raw) as SavedState;
    if (
      s.version !== 1 ||
      !s.settings ||
      !Array.isArray(s.apartments) ||
      !Array.isArray(s.settings.people) ||
      s.settings.people.length !== 2
    )
      throw Error();
    const c = s.settings;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(c.date) ||
      !["transit", "walking"].includes(c.mode) ||
      !c.people.every(
        (p) =>
          typeof p.id === "string" &&
          typeof p.name === "string" &&
          /^([01]\d|2[0-3]):[0-5]\d$/.test(p.arrival) &&
          (p.work === null || validLocation(p.work)),
      ) ||
      new Set(c.people.map((p) => p.id)).size !== 2
    )
      throw Error();
    if (
      !c.daycare ||
      typeof c.daycare.enabled !== "boolean" ||
      !c.people.some((p) => p.id === c.daycare.personId) ||
      !Number.isInteger(c.daycare.minutes) ||
      c.daycare.minutes < 0 ||
      c.daycare.minutes > 120 ||
      (c.daycare.location !== null && !validLocation(c.daycare.location))
    )
      throw Error();
    if (
      !s.apartments.every(
        (a) =>
          typeof a.id === "string" &&
          typeof a.label === "string" &&
          typeof a.url === "string" &&
          typeof a.notes === "string" &&
          validLocation(a.location),
      ) ||
      new Set(s.apartments.map((a) => a.id)).size !== s.apartments.length
    )
      throw Error();
    return { state: s, warning: "" };
  } catch {
    return {
      state: initialState(),
      warning:
        "Saved settings could not be read. You can still use the app; new changes will replace them.",
    };
  }
}
export function safeUrl(value: string): string | null {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
export function sortedApartments(
  apartments: Apartment[],
  sort: string,
  results: Results,
): Apartment[] {
  if (!sort) return apartments;
  return [...apartments].sort((a, b) => {
    const time = (id: string) => {
      const r = results[resultKey(id, sort)];
      return r?.status === "success" ? r.journey!.minutes : Infinity;
    };
    return time(a.id) - time(b.id) || 0;
  });
}
