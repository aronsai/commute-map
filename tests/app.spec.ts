import { test, expect, type Page } from "@playwright/test";
import { localTimestamp } from "../src/time";
async function mockSL(
  page: Page,
  options: { slow?: boolean; failPartner?: boolean; noGeometry?: boolean } = {},
) {
  await page.route(
    "**/journeyplanner.integration.sl.se/v2/**",
    async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("system-info"))
        return route.fulfill({
          json: { validity: { from: "2026-07-24", to: "2026-12-13" } },
        });
      if (url.pathname.endsWith("stop-finder")) {
        const text = url.searchParams.get("name_sf")!;
        const coord = text.includes("Partner")
          ? [59.35, 18.1]
          : text.includes("Daycare")
            ? [59.34, 18.065]
            : [59.33, 18.06];
        return route.fulfill({
          json: {
            locations: [{ name: `${text}, Stockholm`, coord, id: text }],
          },
        });
      }
      if (options.slow) await new Promise((r) => setTimeout(r, 1800));
      if (
        options.failPartner &&
        url.searchParams.get("name_destination")?.startsWith("18.1:")
      )
        return route.fulfill({ status: 503, body: "{}" }).catch(() => {});
      const date = url.searchParams.get("itd_date")!,
        time = url.searchParams.get("itd_time")!;
      const arrival = localTimestamp(
        `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
        `${time.slice(0, 2)}:${time.slice(2, 4)}`,
      );
      const minutes = url.searchParams.get("name_origin")?.startsWith("18.08:")
        ? 18
        : 32;
      const origin = {
        name: "Home or daycare",
        departureTimePlanned: new Date(arrival - minutes * 60000).toISOString(),
      };
      const destination = {
        name: "Destination",
        arrivalTimePlanned: new Date(arrival).toISOString(),
      };
      const walk =
        url.searchParams.get("compute_monomodal_trip_pedestrian") === "true";
      await route
        .fulfill({
          json: {
            journeys: [
              {
                legs: [
                  {
                    origin,
                    destination,
                    transportation: {
                      name: walk ? "footpath" : "Metro 17",
                      product: { class: walk ? 100 : 2 },
                    },
                    coords: options.noGeometry
                      ? undefined
                      : [
                          [59.33, 18.06],
                          [59.35, 18.1],
                        ],
                  },
                ],
              },
            ],
          },
        })
        .catch(() => {});
    },
  );
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+X75ALAAAAABJRU5ErkJggg==",
        "base64",
      ),
    }),
  );
}
async function selectLocation(page: Page, label: string, query: string) {
  await page.getByRole("textbox", { name: label, exact: true }).fill(query);
  await page
    .getByRole("button", { name: `${query}, Stockholm`, exact: true })
    .click();
}
async function setup(page: Page, daycare = false) {
  await page.goto("");
  await selectLocation(page, "You workplace", "Work A");
  await selectLocation(page, "Partner workplace", "Partner Work");
  await page.getByLabel("Commute date", { exact: true }).fill("2026-10-26");
  if (daycare) {
    await page
      .getByRole("button", { name: "Add daycare", exact: true })
      .click();
    await selectLocation(page, "Dog daycare 1", "Daycare");
  }
}
async function addApartment(
  page: Page,
  name = "Södermalm home",
  coordinates = false,
) {
  await page
    .getByRole("button", { name: "Add apartment", exact: true })
    .click();
  await page.getByLabel("Apartment name", { exact: true }).fill(name);
  if (coordinates) {
    await page
      .getByRole("dialog")
      .getByText("Enter or adjust coordinates", { exact: true })
      .click();
    await page
      .getByLabel("Apartment address latitude", { exact: true })
      .fill("59.34");
    await page
      .getByLabel("Apartment address longitude", { exact: true })
      .fill("18.08");
    await page
      .getByRole("button", { name: "Set location", exact: true })
      .click();
  } else await selectLocation(page, "Apartment address", "Apartment Street");
  if (
    (await page
      .getByRole("dialog")
      .getByLabel("Dog daycare", { exact: true })
      .locator("option")
      .count()) > 1
  )
    await page
      .getByRole("dialog")
      .getByLabel("Dog daycare", { exact: true })
      .selectOption({ index: 1 });
  await page
    .getByRole("button", { name: "Add to shortlist", exact: true })
    .click();
}
test("setup, CRUD, storage, routing, walking, sorting, stale results and route details", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mockSL(page);
  await setup(page, true);
  await addApartment(page);
  await expect(
    page.getByLabel("Daycare for Södermalm home", { exact: true }),
  ).not.toHaveValue("");
  await page.getByRole("button", { name: "Edit Södermalm home" }).click();
  await page.getByLabel("Notes optional").fill("Viewing Sunday");
  await page.getByLabel("Listing URL optional").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText("http://");
  await page.getByLabel("Listing URL optional").fill("https://www.booli.se/");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.reload();
  await expect(page.getByText("Viewing Sunday")).toBeVisible();
  await addApartment(page, "Kungsholmen home", true);
  await page
    .getByRole("button", { name: "Calculate commutes", exact: true })
    .click();
  await expect(page.getByText("69 min")).toHaveCount(0); // Hour-format durations are used above 60 minutes.
  await expect(
    page.getByRole("button", { name: "Show You route for Södermalm home" }),
  ).toContainText("1h 9m");
  await expect(
    page.getByRole("button", { name: "Show Partner route for Södermalm home" }),
  ).toContainText("32 min");
  await page.getByLabel("Sort apartments").selectOption("you");
  await expect(page.locator(".apartment-card h2").first()).toHaveText(
    "Kungsholmen home",
  );
  await page
    .getByRole("button", { name: "Show You route for Södermalm home" })
    .click();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Selected journey" }),
  ).toContainText("Dog drop-off");
  await expect(
    page.locator(".leaflet-overlay-pane path").first(),
  ).toBeVisible();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Shortlist", exact: true }).click();
  await page.getByRole("button", { name: "Walking only", exact: true }).click();
  await expect(page.getByText("Settings changed.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show You route for Södermalm home" }),
  ).toContainText("Needs recalculation");
  await page
    .getByRole("button", { name: "Calculate commutes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Show Partner route for Södermalm home" }),
  ).toContainText("32 min walk");
  await page.getByRole("button", { name: "Delete Kungsholmen home" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.locator(".apartment-card")).toHaveCount(1);
  expect(errors).toEqual([]);
});
test("cancel, refresh and partial failures", async ({ page }) => {
  await mockSL(page, { slow: true, failPartner: true });
  await setup(page);
  await addApartment(page);
  await page
    .getByRole("button", { name: "Calculate commutes", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Show You route for Södermalm home" }),
  ).toContainText("Cancelled");
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "Refresh commutes" }).click();
  await expect(
    page.getByRole("button", { name: "Show You route for Södermalm home" }),
  ).toContainText("32 min");
  await expect(
    page.getByRole("button", { name: "Show Partner route for Södermalm home" }),
  ).toContainText("503");
});
test("map placement and keyboard coordinate alternative", async ({
  page,
}, info) => {
  await mockSL(page);
  await page.goto("");
  await page
    .getByRole("button", { name: "Add apartment", exact: true })
    .click();
  await expect(
    page.getByLabel("Apartment name", { exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Close apartment editor" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Add to shortlist" }),
  ).toBeFocused();
  await page.getByLabel("Apartment name", { exact: true }).fill("Pinned home");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Choose on map" })
    .click();
  await page.locator(".leaflet-map").click({
    position: { x: info.project.name === "mobile" ? 200 : 460, y: 300 },
  });
  await page.getByRole("button", { name: "Use location", exact: true }).click();
  await expect(
    page.getByLabel("Apartment address", { exact: true }),
  ).toHaveValue(/Map pin/);
  await page.getByRole("button", { name: "Add to shortlist" }).click();
  await expect(
    page.getByRole("heading", { name: "Pinned home" }),
  ).toBeVisible();
});
test("storage denial stays usable and no route geometry remains honest", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
  });
  await mockSL(page, { noGeometry: true });
  await setup(page);
  await addApartment(page);
  await expect(
    page.getByText("Browser storage is unavailable or full."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Calculate commutes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Show You route for Södermalm home" }),
  ).toContainText("32 min");
  await page
    .getByRole("button", { name: "Show You route for Södermalm home" })
    .click();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.getByText("SL did not provide map geometry")).toBeVisible();
  await expect(page.locator(".leaflet-overlay-pane path")).toHaveCount(0);
});

test("multiple daycares, per-apartment selection, edit, deletion and map navigation", async ({
  page,
}, info) => {
  await mockSL(page);
  await setup(page, true);
  await page.getByRole("button", { name: "Add daycare", exact: true }).click();
  await selectLocation(page, "Dog daycare 2", "Second Daycare");
  await addApartment(page);
  await page
    .getByLabel("Daycare for Södermalm home", { exact: true })
    .selectOption({ index: 2 });
  await addApartment(page, "Direct home");
  await page
    .getByLabel("Daycare for Direct home", { exact: true })
    .selectOption("");
  await selectLocation(page, "Dog daycare 2", "Edited Daycare");
  await page.reload();
  await expect(
    page
      .getByLabel("Daycare for Södermalm home", { exact: true })
      .locator("option:checked"),
  ).toHaveText("Edited Daycare, Stockholm");
  await page
    .getByRole("button", { name: "Calculate commutes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Show You route for Södermalm home" }),
  ).toContainText("1h 9m");
  await expect(
    page.getByRole("button", { name: "Show You route for Direct home" }),
  ).toContainText("32 min");
  await page
    .getByLabel("Daycare for Södermalm home", { exact: true })
    .selectOption({ index: 1 });
  await expect(page.getByText("Settings changed.")).toBeVisible();
  await page
    .getByRole("button", { name: "Delete daycare 1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove daycare", exact: true })
    .click();
  await expect(
    page.getByLabel("Daycare for Södermalm home", { exact: true }),
  ).toHaveValue("");
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Map", exact: true }).click();
  const map = page.locator(".leaflet-map");
  const box = (await map.boundingBox())!;
  const pane = page.locator(".leaflet-map-pane");
  const before = await pane.getAttribute("style");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 90,
    box.y + box.height / 2 + 60,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect(pane).not.toHaveAttribute("style", before!);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(
    page.locator(".topbar, .intro, .map-title, .map-onboarding"),
  ).toHaveCount(0);
  await expect(page.locator(".leaflet-tile-pane")).toHaveCSS("filter", "none");
});

test("legacy browser data migrates and daycare map pins persist", async ({
  page,
}, info) => {
  await mockSL(page);
  await page.addInitScript(() => {
    if (localStorage.getItem("hemvag:v1")) return;
    const location = { label: "Saved place", lat: 59.33, lng: 18.06 };
    localStorage.setItem(
      "hemvag:v1",
      JSON.stringify({
        version: 1,
        settings: {
          people: [
            { id: "you", name: "You", work: location, arrival: "09:00" },
            {
              id: "partner",
              name: "Partner",
              work: location,
              arrival: "09:00",
            },
          ],
          date: "2026-10-26",
          mode: "transit",
          daycare: { enabled: true, location, personId: "you", minutes: 5 },
        },
        apartments: [
          {
            id: "saved-home",
            label: "Saved home",
            location,
            notes: "Saved note",
            url: "",
          },
        ],
      }),
    );
  });
  await page.goto("");
  await expect(
    page.getByLabel("Daycare for Saved home", { exact: true }),
  ).toHaveValue("migrated-daycare");
  await expect(page.getByText("Saved note", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Add apartment", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Dog daycare", { exact: true }),
  ).toHaveValue("");
  await page.getByRole("button", { name: "Close apartment editor" }).click();
  await page
    .locator(".daycare-entry")
    .getByRole("button", { name: "Choose on map" })
    .click();
  await page
    .locator(".leaflet-map")
    .click({
      position: { x: info.project.name === "mobile" ? 200 : 460, y: 300 },
    });
  await page.getByRole("button", { name: "Use location", exact: true }).click();
  await expect(page.getByLabel("Dog daycare 1", { exact: true })).toHaveValue(
    /Map pin/,
  );
  await page.reload();
  await expect(page.getByLabel("Dog daycare 1", { exact: true })).toHaveValue(
    /Map pin/,
  );
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("hemvag:v1")!).version,
    ),
  ).toBe(2);
});
