# Hemväg · Stockholm commute map

Compare apartments against two morning commutes, including an optional dog daycare stop. Transit and walking-only routes come directly from SL. Settings and the apartment shortlist are stored in the current browser; there are no accounts, backend, API keys, analytics, or automatic listing imports.

Live site: **https://aronsai.github.io/commute-map/**

## Use

1. Select both workplaces from address search (or choose map pins / enter coordinates), and set each person's arrival deadline.
2. Optionally enable dog daycare, choose its location, assign the drop-off, and set its duration.
3. Add apartments with an address or pin, optional listing URL, and notes.
4. Choose a date within SL's timetable window and a travel mode, then calculate. Click a person's result for the itinerary and map route. On mobile, use the Map tab.
5. Results preserve the order added. Sort explicitly by either person's travel time if desired. Refresh bypasses cached results; Cancel stops pending calculations. Changing route inputs hides obsolete results until recalculated.

The next available weekday, 09:00 arrivals, public transit, and a five-minute drop-off are defaults. Daycare starts disabled. No personal or example locations are preloaded.

## Local development

Use Node.js 24+ and npm. All project dependencies and the lockfile are local to this directory.

```sh
npm ci
npm run dev
```

Open the printed URL at `/commute-map/`.

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
# Optional, contacts SL using only public test locations:
npm run test:live
npm run preview -- --port 4173
```

Preview serves the built app at http://127.0.0.1:4173/commute-map/. Browser tests build on the production output, mock SL and map tiles, and cover desktop and mobile Chromium. Run `npm run build` before them. CI installs Chromium's OS dependencies too. Tests do not require live SL access.

## Routing and limitations

- SL Journey Planner v2: https://www.trafiklab.se/api/other-apis/sl/journey-planner-2/ and its linked OpenAPI schema. Requests are made directly from the browser without credentials. Availability and CORS depend on SL.
- Arrival-time searches choose the latest feasible departure from SL's returned journeys, then shorter duration and fewer transfers. This is a comparison of the returned options, not an exhaustive timetable optimisation.
- Daycare is an address-to-address pair of journeys. First calculate daycare → work backwards from the deadline, then home → daycare with time for drop-off. Total time includes waiting and drop-off; transfer counts sum the two journeys' transfers.
- Walking-only results contain only pedestrian legs. SL limits these to 120 minutes per leg. Missing routes are reported without straight-line estimates. Bike journeys, national trains, and restricted/on-demand services are excluded.
- Timetable and available realtime estimates are identified in results. Times use Europe/Stockholm, independently of the browser timezone. Check SL before travelling.
- Geometry comes from SL. Missing geometry leaves the itinerary available without invented map segments.
- At most two SL requests run concurrently. Identical requests are deduplicated and successful responses cached in memory for five minutes. Refresh clears that cache. Address queries are debounced 400 ms. No map-movement calculations or background polling.
- The free endpoint is for modest interactive use, not citywide analysis or a heatmap. SL may return no route, enforce limits, or be temporarily unavailable.

## Data and dependencies

React, TypeScript, Vite, Leaflet, and locally bundled DM Sans / Manrope fonts. OpenStreetMap standard tiles use visible attribution, normal browser caching, and no prefetch/offline downloads: https://operations.osmfoundation.org/policies/tiles/.

Saved addresses and notes remain under the versioned `hemvag:v1` localStorage key on this origin. Clearing browser site data removes them. Private browsing, blocked storage, or browser limits can prevent saving; the interface warns and remains usable. GitHub Pages projects on the same origin share browser storage security boundaries; do not treat this as a secure vault.

SL receives address searches and route coordinates. OpenStreetMap receives map requests. GitHub hosts the public app. Opening a listing sends you to that site. No entered locations are committed, added to share URLs, logged, or included in built artifacts. Booli links do not fetch or import listing details.

## Deployment and rollback

Repository: https://github.com/aronsai/commute-map

GitHub Pages uses **GitHub Actions**, configured in `.github/workflows/pages.yml`. Vite's base path is `/commute-map/`. There are no nested page routes or server rewrites. The workflow checks pull requests and pushes to `main` with type checking, unit tests, a production build, and mocked desktop/mobile browser tests. Only a successful `main` run uploads `dist/` and deploys it through official Pages actions. No deployment secrets are required.

To deploy a change, open a PR, pass checks, merge to `main`, then inspect the **Check and deploy** workflow and the live site. Verify assets, refresh, map tiles, an SL query, and local persistence. To roll back, revert the faulty commit on `main`; the same workflow redeploys the restored app. Saved browser settings are independent of deployments; preserve the storage format or add a migration before changing it.
