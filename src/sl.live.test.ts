import { expect, it } from "vitest";
import { calculateCommute, SLClient } from "./sl";
import { initialState } from "./state";
import { localTimestamp, nextWeekday } from "./time";
// Opt-in only: CI and ordinary unit tests never contact SL.
it.skipIf(!process.env.SL_LIVE)(
  "SL public Stockholm locations: lookup, transit, walking and daycare",
  async () => {
    const client = new SLClient();
    const validity = await client.validity();
    const date = nextWeekday(Date.now(), validity.from, validity.to);
    const deadline = localTimestamp(date, "09:00");
    const found = await client.search("Stockholm Odenplan");
    expect(found.length).toBeGreaterThan(0);
    const home = {
      label: "Kungsträdgården public test location",
      lat: 59.3293,
      lng: 18.0686,
    };
    const work = {
      label: "Odenplan public test location",
      lat: 59.343,
      lng: 18.055,
    };
    const daycare = {
      label: "Centralen public test waypoint",
      lat: 59.3337,
      lng: 18.058,
    };
    const transit = await client.journey({
      origin: home,
      destination: work,
      deadline,
      mode: "transit",
    });
    expect(transit.arrival).toBeLessThanOrEqual(deadline);
    expect(transit.legs.some((l) => l.mode === "transit")).toBe(true);
    const walk = await client.journey({
      origin: home,
      destination: work,
      deadline,
      mode: "walking",
    });
    expect(walk.arrival).toBeLessThanOrEqual(deadline);
    expect(walk.legs.every((l) => l.mode === "walk")).toBe(true);
    const settings = initialState().settings;
    settings.date = date;
    settings.people[0].work = work;
    settings.daycares = [{ id: "test-daycare", location: daycare }];
    settings.daycare = {
      personId: "you",
      minutes: 5,
    };
    const via = await calculateCommute(
      client,
      home,
      settings.people[0],
      settings,
      deadline,
      undefined,
      "test-daycare",
    );
    expect(via.arrival).toBeLessThanOrEqual(deadline);
    const dropoff = via.legs.find((l) => l.mode === "dropoff")!;
    expect(dropoff.arrival - dropoff.departure).toBe(300000);
    expect(via.minutes).toBe(Math.ceil((via.arrival - via.departure) / 60000));
    console.log(
      `Live SL verified for ${date}: transit ${transit.minutes} min, walking ${walk.minutes} min, daycare ${via.minutes} min.`,
    );
  },
  60000,
);
