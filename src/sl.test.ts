import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateCommute,
  coordinate,
  makeJourney,
  parseJourneys,
  parseLocations,
  selectJourney,
  SLClient,
  tripParameters,
  WALK_ERROR,
} from "./sl";
import { clock, localTimestamp, nextWeekday } from "./time";
import {
  initialState,
  loadState,
  safeUrl,
  sortedApartments,
  storageKey,
} from "./state";
import type { Apartment, Journey, Leg, Location } from "./types";
const place: Location = { label: "Public place", lat: 59.33, lng: 18.06 };
const deadline = localTimestamp("2026-10-26", "09:00");
function leg(
  start = deadline - 30 * 60000,
  end = deadline,
  mode: Leg["mode"] = "transit",
): Leg {
  return {
    mode,
    label: "Metro",
    from: "A",
    to: "B",
    departure: start,
    arrival: end,
    geometry: [],
    realtime: false,
  };
}
const journey = (start: number, end: number, mode: Leg["mode"] = "transit") =>
  makeJourney([leg(start, end, mode)]);
function response(classId = 2, overrides = {}) {
  return {
    journeys: [
      {
        legs: [
          {
            origin: {
              name: "A",
              departureTimePlanned: new Date(deadline - 1800000).toISOString(),
            },
            destination: {
              name: "B",
              arrivalTimePlanned: new Date(deadline).toISOString(),
            },
            transportation: {
              name: "Metro 17",
              product: {
                class: classId,
                name: classId === 99 ? "footpath" : "Tunnelbana",
              },
            },
            coords: [
              [59.33, 18.06],
              [59.34, 18.05],
            ],
            ...overrides,
          },
        ],
      },
    ],
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("SL boundary and selection", () => {
  it("uses longitude:latitude in requests and latitude:longitude on the map", () => {
    expect(coordinate(place)).toBe("18.06:59.33:WGS84[dd.ddddd]");
    expect(
      parseLocations({
        locations: [
          { name: "Slussen", coord: [59.3, 18.1], id: "s" },
          { name: "bad", coord: [null, 0] },
        ],
      }),
    ).toEqual([{ label: "Slussen", lat: 59.3, lng: 18.1, slId: "s" }]);
    expect(parseJourneys(response())[0].legs[0].geometry[0]).toEqual([
      59.33, 18.06,
    ]);
  });
  it("requests arrival time in Stockholm, excludes bike and restricted services", () => {
    const p = tripParameters({
      origin: place,
      destination: place,
      deadline,
      mode: "walking",
    });
    expect(p.get("itd_time")).toBe("0900");
    expect(p.get("itd_trip_date_time_dep_arr")).toBe("arr");
    expect(p.get("compute_monomodal_trip_pedestrian")).toBe("true");
    expect(p.get("max_time_pedestrian")).toBe("120");
    for (const key of [
      "incl_mot_10",
      "incl_mot_14",
      "incl_mot_19",
      "compute_monomodal_trip_bicycle",
    ])
      expect(p.get(key)).toBe("false");
  });
  it("selects the latest feasible departure, breaking ties by duration then transfers", () => {
    const a = journey(deadline - 1800000, deadline),
      b = journey(deadline - 1200000, deadline - 1000);
    const late = journey(deadline - 100000, deadline + 1);
    expect(selectJourney([a, late, b], deadline, "transit")).toBe(b);
    const shorter = { ...b, minutes: b.minutes - 1 };
    expect(selectJourney([b, shorter], deadline, "transit")).toBe(shorter);
    expect(
      selectJourney([{ ...b, transfers: 2 }, b], deadline, "transit"),
    ).toBe(b);
  });
  it("only permits pedestrian journeys for walking mode including SL class 99", () => {
    const walk = parseJourneys(response(99))[0];
    expect(walk.walkingMinutes).toBe(30);
    expect(
      selectJourney([walk, ...parseJourneys(response())], deadline, "walking"),
    ).toBe(walk);
    expect(() =>
      selectJourney(parseJourneys(response()), deadline, "walking"),
    ).toThrow(WALK_ERROR);
    expect(parseJourneys(response(107))).toEqual([]);
  });
  it("uses estimated timestamps when available and rejects incomplete or overlapping legs", () => {
    const data = response(2, {
      origin: {
        name: "A",
        departureTimePlanned: new Date(deadline - 1800000).toISOString(),
        departureTimeEstimated: new Date(deadline - 1200000).toISOString(),
      },
    });
    expect(parseJourneys(data)[0]).toMatchObject({
      realtime: true,
      minutes: 20,
    });
    expect(parseJourneys(response(2, { destination: {} }))).toEqual([]);
    expect(
      parseJourneys({
        journeys: [
          {
            legs: [
              ...response().journeys[0].legs,
              ...response().journeys[0].legs,
            ],
          },
        ],
      }),
    ).toEqual([]);
    expect(
      parseJourneys({ systemMessages: [{ type: "error" }], ...response() }),
    ).toHaveLength(1);
    expect(parseJourneys(null)).toEqual([]);
  });
});
describe("daycare chaining", () => {
  it("works backwards, includes drop-off and waiting, and only affects assigned person", async () => {
    const settings = initialState().settings;
    settings.people.forEach((p) => (p.work = place));
    settings.daycares = [
      { id: "test-daycare", location: { ...place, label: "Daycare" } },
    ];
    settings.daycare = {
      personId: "you",
      minutes: 5,
    };
    const second = journey(deadline - 1200000, deadline);
    const first = journey(deadline - 3000000, deadline - 1800000, "walk");
    const client = {
      journey: vi
        .fn()
        .mockResolvedValueOnce(second)
        .mockResolvedValueOnce(first),
    };
    const result = await calculateCommute(
      client,
      place,
      settings.people[0],
      settings,
      deadline,
      undefined,
      "test-daycare",
    );
    expect(client.journey.mock.calls[1][0].deadline).toBe(
      second.departure - 300000,
    );
    expect(result.minutes).toBe(50);
    expect(result.walkingMinutes).toBe(20);
    expect(result.legs.map((l) => l.mode)).toEqual([
      "walk",
      "dropoff",
      "wait",
      "transit",
    ]);
    client.journey.mockReset().mockResolvedValue(second);
    await calculateCommute(
      client,
      place,
      settings.people[1],
      settings,
      deadline,
      undefined,
      "test-daycare",
    );
    expect(client.journey).toHaveBeenCalledTimes(1);
  });
  it("rejects connections that do not allow drop-off time", async () => {
    const settings = initialState().settings;
    settings.people[0].work = place;
    settings.daycares = [{ id: "test-daycare", location: place }];
    settings.daycare = {
      personId: "you",
      minutes: 5,
    };
    const client = {
      journey: vi
        .fn()
        .mockResolvedValueOnce(journey(deadline - 1200000, deadline))
        .mockResolvedValueOnce(journey(deadline - 1800000, deadline - 1200000)),
    };
    await expect(
      calculateCommute(
        client,
        place,
        settings.people[0],
        settings,
        deadline,
        undefined,
        "test-daycare",
      ),
    ).rejects.toThrow("enough time");
  });
});
describe("request control", () => {
  it("deduplicates concurrent calls, caches five minutes, and refresh clears cache", async () => {
    let now = 0;
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ ok: true })),
    );
    const client = new SLClient(fetcher as typeof fetch, () => now);
    await Promise.all([client.request("/same"), client.request("/same")]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now = 299999;
    await client.request("/same");
    expect(fetcher).toHaveBeenCalledTimes(1);
    now = 300000;
    await client.request("/same");
    expect(fetcher).toHaveBeenCalledTimes(2);
    client.clear();
    await client.request("/same");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("never exceeds two concurrent requests", async () => {
    let active = 0,
      max = 0;
    const client = new SLClient((async () => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return new Response("{}");
    }) as typeof fetch);
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => client.request(`/${i}`)),
    );
    expect(max).toBe(2);
  });
  it("cancelling one subscriber preserves a shared request and cancelled calls can restart", async () => {
    const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 20);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
      return new Response("{}");
    });
    const client = new SLClient(fetcher as typeof fetch);
    const cancelled = new AbortController();
    const first = client.request("/shared", cancelled.signal);
    const second = client.request("/shared");
    cancelled.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toEqual({});
    expect(fetcher).toHaveBeenCalledTimes(1);
    const restarted = new AbortController();
    const old = client.request("/restart", restarted.signal);
    restarted.abort();
    const fresh = client.request("/restart");
    await expect(old).rejects.toMatchObject({ name: "AbortError" });
    await expect(fresh).resolves.toEqual({});
  });
  it("reports rate limits and cancellation without caching failures", async () => {
    const limited = new SLClient(
      (async () => new Response("", { status: 429 })) as typeof fetch,
    );
    await expect(limited.request("/limited")).rejects.toThrow("rate limiting");
    const controller = new AbortController();
    controller.abort();
    await expect(
      limited.request("/aborted", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
describe("local state and timezone", () => {
  it("converts winter and summer deadlines independently of host timezone", () => {
    expect(new Date(localTimestamp("2026-01-15", "09:00")).toISOString()).toBe(
      "2026-01-15T08:00:00.000Z",
    );
    expect(new Date(localTimestamp("2026-07-15", "09:00")).toISOString()).toBe(
      "2026-07-15T07:00:00.000Z",
    );
    expect(clock(localTimestamp("2026-10-25", "09:00"))).toBe("09:00");
    expect(() => localTimestamp("2026-03-29", "02:30")).toThrow("clock change");
    expect(nextWeekday(Date.parse("2026-10-23T12:00Z"))).toBe("2026-10-26");
    expect(
      nextWeekday(Date.parse("2026-10-23T12:00Z"), "2026-10-28", "2026-11-01"),
    ).toBe("2026-10-28");
  });
  it("keeps insertion order unless explicitly sorted and puts unavailable results last", () => {
    const a = (id: string): Apartment => ({
      id,
      label: id,
      location: place,
      notes: "",
      url: "",
    });
    const apartments = [a("a"), a("b"), a("c")];
    const results = {
      "a:you": {
        status: "success" as const,
        journey: { minutes: 45 } as Journey,
      },
      "c:you": {
        status: "success" as const,
        journey: { minutes: 20 } as Journey,
      },
    };
    expect(sortedApartments(apartments, "", results)).toBe(apartments);
    expect(
      sortedApartments(apartments, "you", results).map((a) => a.id),
    ).toEqual(["c", "a", "b"]);
  });
  it("validates listing URLs and handles blocked/corrupt localStorage", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("https://www.booli.se/")).toBe("https://www.booli.se/");
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw Error("blocked");
      },
    });
    expect(loadState().warning).toBeTruthy();
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify({ ...initialState(), apartments: [{ id: "x" }] }),
    });
    expect(loadState().warning).toBeTruthy();
    const state = initialState();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === storageKey ? JSON.stringify(state) : null,
    });
    expect(loadState().state).toEqual(state);
  });
});

describe("daycare persistence migration", () => {
  for (const enabled of [true, false]) {
    it(`preserves legacy settings with daycare enabled=${enabled}`, () => {
      const current = initialState();
      const legacy = {
        ...current,
        version: 1,
        settings: {
          ...current.settings,
          daycare: { ...current.settings.daycare, enabled, location: place },
        },
        apartments: [
          {
            id: "home",
            label: "Home",
            location: place,
            notes: "Keep notes",
            url: "",
          },
        ],
      };
      vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(legacy) });
      const loaded = loadState();
      expect(loaded.warning).toBe("");
      expect(loaded.state.version).toBe(2);
      expect(loaded.state.settings.daycares).toEqual([
        { id: "migrated-daycare", location: place },
      ]);
      expect(loaded.state.apartments[0]).toMatchObject({
        notes: "Keep notes",
        daycareId: enabled ? "migrated-daycare" : null,
      });
    });
  }
  it("routes through the selected daycare and supports no daycare", async () => {
    const settings = initialState().settings;
    settings.people[0].work = place;
    const other = { ...place, lat: 59.4, label: "Second daycare" };
    settings.daycares = [
      { id: "first", location: place },
      { id: "second", location: other },
    ];
    const client = {
      journey: vi
        .fn()
        .mockResolvedValueOnce(journey(deadline - 1200000, deadline))
        .mockResolvedValueOnce(journey(deadline - 3000000, deadline - 1800000)),
    };
    await calculateCommute(
      client,
      place,
      settings.people[0],
      settings,
      deadline,
      undefined,
      "second",
    );
    expect(client.journey.mock.calls[0][0].origin).toEqual(other);
    expect(client.journey.mock.calls[1][0].destination).toEqual(other);
    client.journey
      .mockReset()
      .mockResolvedValue(journey(deadline - 1200000, deadline));
    await calculateCommute(
      client,
      place,
      settings.people[0],
      settings,
      deadline,
    );
    expect(client.journey).toHaveBeenCalledTimes(1);
    expect(client.journey.mock.calls[0][0].destination).toEqual(place);
  });
});
