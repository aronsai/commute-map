import type {
  Journey,
  JourneyQuery,
  Leg,
  Location,
  Mode,
  Person,
  Settings,
} from "./types";
import { stockholmParts } from "./time";
export const API = "https://journeyplanner.integration.sl.se/v2";
export const WALK_ERROR =
  "No walking route returned within SL’s 120-minute per-leg limit";
type RecordValue = Record<string, any>; // External SL schema is normalised and validated at this boundary.
const object = (v: unknown): RecordValue =>
  v && typeof v === "object" ? (v as RecordValue) : {};
export function coordinate(location: Location) {
  return `${location.lng}:${location.lat}:WGS84[dd.ddddd]`;
}
export function parseLocations(data: unknown): Location[] {
  const locations = object(data).locations;
  if (!Array.isArray(locations)) return [];
  return locations.flatMap((v) => {
    const l = object(v);
    return typeof l.name === "string" &&
      Array.isArray(l.coord) &&
      l.coord.length >= 2 &&
      l.coord.every(
        (n: unknown) => typeof n === "number" && Number.isFinite(n),
      ) &&
      Math.abs(l.coord[0]) <= 90 &&
      Math.abs(l.coord[1]) <= 180
      ? [
          {
            label: l.name,
            lat: l.coord[0],
            lng: l.coord[1],
            slId: typeof l.id === "string" ? l.id : undefined,
          },
        ]
      : [];
  });
}
function timestamp(
  endpoint: RecordValue,
  direction: "departure" | "arrival",
): { time: number; realtime: boolean } {
  for (const suffix of ["Estimated", "Planned", "BaseTimetable"]) {
    const value = endpoint[`${direction}Time${suffix}`];
    const time = typeof value === "string" ? Date.parse(value) : NaN;
    if (Number.isFinite(time))
      return { time, realtime: suffix === "Estimated" };
  }
  return { time: NaN, realtime: false };
}
export function makeJourney(legs: Leg[]): Journey {
  const departure = legs[0].departure,
    arrival = legs.at(-1)!.arrival;
  const rides = legs.filter((l) => l.mode === "transit");
  return {
    departure,
    arrival,
    minutes: Math.ceil((arrival - departure) / 60000),
    walkingMinutes: Math.ceil(
      legs
        .filter((l) => l.mode === "walk")
        .reduce((n, l) => n + l.arrival - l.departure, 0) / 60000,
    ),
    transfers: Math.max(0, rides.length - 1),
    realtime: legs.some((l) => l.realtime),
    legs,
  };
}
export function parseJourneys(data: unknown): Journey[] {
  const journeys = object(data).journeys;
  if (!Array.isArray(journeys)) return [];
  return journeys.flatMap((value) => {
    const raw = object(value);
    if (!Array.isArray(raw.legs) || !raw.legs.length) return [];
    const legs: Leg[] = [];
    for (const v of raw.legs) {
      const l = object(v),
        t = object(l.transportation),
        product = object(t.product);
      const walk =
        product.class === 100 ||
        product.id === 100 ||
        /^(walk|foot|gång|gångväg)/i.test(String(product.name ?? t.name ?? ""));
      if (!walk && ![0, 2, 4, 5, 9].includes(product.class)) return [];
      if (
        !walk &&
        (l.properties?.ON_DEMAND_LEG === "1" ||
          l.origin?.properties?.callType?.includes("ONDEMAND"))
      )
        return [];
      const start = timestamp(object(l.origin), "departure"),
        end = timestamp(object(l.destination), "arrival");
      if (
        !Number.isFinite(start.time) ||
        !Number.isFinite(end.time) ||
        end.time < start.time ||
        (legs.length && start.time < legs.at(-1)!.arrival)
      )
        return [];
      const coords = Array.isArray(l.coords) ? l.coords : l.coords?.positions;
      const geometry: [number, number][] = Array.isArray(coords)
        ? coords
            .filter(
              (p: unknown) =>
                Array.isArray(p) &&
                p.length >= 2 &&
                p
                  .slice(0, 2)
                  .every((n) => typeof n === "number" && Number.isFinite(n)) &&
                Math.abs(p[0]) <= 90 &&
                Math.abs(p[1]) <= 180,
            )
            .map((p: number[]) => [p[0], p[1]])
        : [];
      legs.push({
        mode: walk ? "walk" : "transit",
        label: walk
          ? "Walk"
          : String(t.disassembledName ?? t.name ?? product.name ?? "Transit"),
        from: String(l.origin?.name ?? "Origin"),
        to: String(l.destination?.name ?? "Destination"),
        departure: start.time,
        arrival: end.time,
        geometry,
        realtime: start.realtime || end.realtime,
      });
    }
    return [makeJourney(legs)];
  });
}
export function selectJourney(
  journeys: Journey[],
  deadline: number,
  mode: Mode,
): Journey {
  const candidates = journeys.filter(
    (j) =>
      j.arrival <= deadline &&
      (mode !== "walking" || j.legs.every((l) => l.mode === "walk")),
  );
  candidates.sort(
    (a, b) =>
      b.departure - a.departure ||
      a.minutes - b.minutes ||
      a.transfers - b.transfers,
  );
  if (!candidates.length)
    throw new Error(
      mode === "walking"
        ? WALK_ERROR
        : "No complete journey arrives by the chosen deadline.",
    );
  return candidates[0];
}
export function tripParameters(q: JourneyQuery): URLSearchParams {
  const p = stockholmParts(q.deadline);
  return new URLSearchParams({
    type_origin: "coord",
    name_origin: coordinate(q.origin),
    type_destination: "coord",
    name_destination: coordinate(q.destination),
    itd_date: p.date.replaceAll("-", ""),
    itd_time: p.time.replace(":", ""),
    itd_trip_date_time_dep_arr: "arr",
    calc_number_of_trips: "3",
    language: "en",
    route_type: "leasttime",
    compute_monomodal_trip_pedestrian: String(q.mode === "walking"),
    max_time_pedestrian: "120",
    compute_monomodal_trip_bicycle: "false",
    incl_mot_0: "true",
    incl_mot_2: "true",
    incl_mot_4: "true",
    incl_mot_5: "true",
    incl_mot_9: "true",
    incl_mot_10: "false",
    incl_mot_14: "false",
    incl_mot_19: "false",
    sel_op: "true",
    use_only: "true",
    use_only_op: "tfs::1",
    gen_c: "true",
  });
}
function abortError() {
  return new DOMException("Calculation cancelled", "AbortError");
}
interface PendingRequest {
  promise: Promise<unknown>;
  controller: AbortController;
  users: number;
}
export class SLClient {
  private cache = new Map<string, { at: number; data: unknown }>();
  private inflight = new Map<string, PendingRequest>();
  private active = 0;
  private generation = 0;
  private queue: { start: () => void; reject: () => void }[] = [];
  constructor(
    private fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
    private now = Date.now,
  ) {}
  clear() {
    this.cache.clear();
    this.generation++;
  }
  private acquire(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.active < 2) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const item = {
        start: () => {
          signal.removeEventListener("abort", abort);
          this.active++;
          resolve();
        },
        reject: () => reject(abortError()),
      };
      const abort = () => {
        this.queue = this.queue.filter((q) => q !== item);
        item.reject();
      };
      signal.addEventListener("abort", abort, { once: true });
      this.queue.push(item);
    });
  }
  async request(path: string, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    const cached = this.cache.get(path);
    if (cached && this.now() - cached.at < 300000) return cached.data;
    let entry = this.inflight.get(path);
    if (!entry || entry.controller.signal.aborted) {
      const controller = new AbortController();
      const generation = this.generation;
      const pending: PendingRequest = {
        controller,
        users: 0,
        promise: Promise.resolve(),
      };
      pending.promise = (async () => {
        await this.acquire(controller.signal);
        const timer = setTimeout(
          () =>
            controller.abort(
              new Error("SL took too long to respond. Try again."),
            ),
          20000,
        );
        try {
          controller.signal.throwIfAborted();
          const response = await this.fetcher(`${API}${path}`, {
            signal: controller.signal,
          });
          if (!response.ok)
            throw new Error(
              response.status === 429
                ? "SL is rate limiting requests. Wait a moment, then refresh."
                : `SL is unavailable (HTTP ${response.status}). Try again shortly.`,
            );
          const data: unknown = await response.json();
          if (generation === this.generation && !controller.signal.aborted) {
            if (this.cache.size >= 200)
              this.cache.delete(this.cache.keys().next().value!);
            this.cache.set(path, { at: this.now(), data });
          }
          return data;
        } finally {
          clearTimeout(timer);
          this.active--;
          this.queue.shift()?.start();
        }
      })().finally(() => {
        if (this.inflight.get(path) === pending) this.inflight.delete(path);
      });
      this.inflight.set(path, pending);
      entry = pending;
    }
    const shared = entry;
    shared.users++;
    return new Promise((resolve, reject) => {
      let finished = false;
      const release = () => {
        if (finished) return false;
        finished = true;
        signal?.removeEventListener("abort", abort);
        if (--shared.users === 0 && this.inflight.get(path) === shared) {
          this.inflight.delete(path);
          shared.controller.abort();
        }
        return true;
      };
      const abort = () => {
        if (release()) reject(abortError());
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      shared.promise.then(
        (data) => {
          if (release()) resolve(data);
        },
        (error) => {
          if (release()) reject(error);
        },
      );
    });
  }
  async search(text: string, signal?: AbortSignal) {
    return parseLocations(
      await this.request(
        `/stop-finder?${new URLSearchParams({ name_sf: text, type_sf: "any", any_obj_filter_sf: "46" })}`,
        signal,
      ),
    );
  }
  async validity(signal?: AbortSignal): Promise<{ from: string; to: string }> {
    const data = object(await this.request("/system-info", signal));
    const range = object(data.validity);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(range.from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(range.to)
    )
      throw new Error("SL did not return its timetable dates.");
    return { from: range.from, to: range.to };
  }
  async journey(q: JourneyQuery, signal?: AbortSignal): Promise<Journey> {
    const p = tripParameters(q);
    p.append("use_only_op", "tfs::8");
    return selectJourney(
      parseJourneys(await this.request(`/trips?${p}`, signal)),
      q.deadline,
      q.mode,
    );
  }
}
export const sl = new SLClient();
export async function calculateCommute(
  client: Pick<SLClient, "journey">,
  home: Location,
  person: Person,
  settings: Settings,
  deadline: number,
  signal?: AbortSignal,
): Promise<Journey> {
  if (!person.work) throw new Error("Choose a workplace first.");
  const daycare = settings.daycare;
  if (!daycare.enabled || daycare.personId !== person.id)
    return client.journey(
      { origin: home, destination: person.work, deadline, mode: settings.mode },
      signal,
    );
  if (!daycare.location) throw new Error("Choose a daycare location first.");
  const second = await client.journey(
    {
      origin: daycare.location,
      destination: person.work,
      deadline,
      mode: settings.mode,
    },
    signal,
  );
  const firstDeadline = second.departure - daycare.minutes * 60000;
  const first = await client.journey(
    {
      origin: home,
      destination: daycare.location,
      deadline: firstDeadline,
      mode: settings.mode,
    },
    signal,
  );
  if (first.arrival > firstDeadline || second.arrival > deadline)
    throw new Error(
      "SL returned a connection that does not leave enough time for drop-off.",
    );
  const legs = [...first.legs];
  if (daycare.minutes)
    legs.push({
      mode: "dropoff",
      label: `Dog drop-off · ${daycare.minutes} min`,
      from: daycare.location.label,
      to: daycare.location.label,
      departure: first.arrival,
      arrival: first.arrival + daycare.minutes * 60000,
      geometry: [],
      realtime: false,
    });
  const dropoffEnd = first.arrival + daycare.minutes * 60000;
  if (dropoffEnd < second.departure)
    legs.push({
      mode: "wait",
      label: "Wait after drop-off",
      from: daycare.location.label,
      to: daycare.location.label,
      departure: dropoffEnd,
      arrival: second.departure,
      geometry: [],
      realtime: false,
    });
  return {
    ...makeJourney([...legs, ...second.legs]),
    transfers: first.transfers + second.transfers,
  };
}
