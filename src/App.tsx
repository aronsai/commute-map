import { useEffect, useRef, useState } from "react";
import {
  ArrowDownUp,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  Dog,
  ExternalLink,
  Footprints,
  House,
  Info,
  Map as MapIcon,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  Settings2,
  TrainFront,
  Trash2,
  X,
} from "lucide-react";
import type {
  Apartment,
  Journey,
  Location,
  Results,
  SavedState,
  Settings,
} from "./types";
import { resultKey } from "./types";
import {
  initialState,
  loadState,
  safeUrl,
  sortedApartments,
  storageKey,
} from "./state";
import { calculateCommute, sl } from "./sl";
import { clock, duration, localTimestamp, nextWeekday } from "./time";
import LocationField from "./LocationField";
import CommuteMap from "./CommuteMap";
const emptyDraft = () => ({
  id: "",
  label: "",
  location: null as Location | null,
  url: "",
  notes: "",
  daycareId: null as string | null,
});
function fingerprint(state: SavedState) {
  return JSON.stringify({
    settings: state.settings,
    apartments: state.apartments.map((a) => ({
      id: a.id,
      location: a.location,
      daycareId: a.daycareId,
    })),
  });
}
export default function App() {
  const [loaded] = useState(loadState);
  const [state, setState] = useState(loaded.state);
  const [storageWarning, setStorageWarning] = useState(loaded.warning);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [rangeError, setRangeError] = useState("");
  const [rangeRetry, setRangeRetry] = useState(0);
  const [results, setResults] = useState<Results>({});
  const [snapshot, setSnapshot] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState("");
  const [mobile, setMobile] = useState<"list" | "map">("list");
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [editor, setEditor] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [draftError, setDraftError] = useState("");
  const [pickTarget, setPickTarget] = useState<string | null>(null);
  const [pendingPin, setPendingPin] = useState<Location | null>(null);
  const [deleteDaycareId, setDeleteDaycareId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const runId = useRef(0);
  const previousFocus = useRef<HTMLElement | null>(null);
  const currentFingerprint = fingerprint(state);
  const stale = !!snapshot && snapshot !== currentFingerprint;
  const settings = state.settings;
  const selectedResult = !stale && selected ? results[selected] : undefined;
  const selectedJourney =
    selectedResult?.status === "success" ? selectedResult.journey : undefined;
  const selectedApartment = selected?.split(":")[0] ?? null;
  const selectedPerson = settings.people.find((p) =>
    selected?.endsWith(`:${p.id}`),
  );
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      setStorageWarning(
        "Browser storage is unavailable or full. Changes will only last for this session.",
      );
    }
  }, [state]);
  useEffect(() => {
    const c = new AbortController();
    setRangeError("");
    sl.validity(c.signal)
      .then((r) => {
        setRange(r);
        setState((s) =>
          s.settings.date === initialState().settings.date &&
          !loaded.state.apartments.length &&
          !loaded.state.settings.people.some((p) => p.work)
            ? {
                ...s,
                settings: {
                  ...s.settings,
                  date: nextWeekday(Date.now(), r.from, r.to),
                },
              }
            : s,
        );
      })
      .catch((e) => {
        if (!c.signal.aborted) setRangeError(e.message);
      });
    return () => c.abort();
  }, [rangeRetry, loaded]);
  useEffect(() => {
    controller.current?.abort();
    setRunning(false);
  }, [currentFingerprint]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!editor) {
      previousFocus.current?.focus();
      return;
    }
    if (pickTarget) return;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !dialog) return;
      const elements = [
        ...dialog.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input, select, textarea, summary, a[href]",
        ),
      ].filter((e) => e.getClientRects().length > 0);
      const first = elements[0],
        last = elements.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  }, [editor, pickTarget]);
  function updateSettings(next: Settings) {
    setState((s) => ({ ...s, settings: next }));
  }
  function updatePerson(
    index: number,
    changes: Partial<Settings["people"][number]>,
  ) {
    updateSettings({
      ...settings,
      people: settings.people.map((p, i) =>
        i === index ? { ...p, ...changes } : p,
      ),
    });
  }
  function pick(target: string) {
    (document.activeElement as HTMLElement | null)?.blur();
    setPendingPin(null);
    setPickTarget(target);
    setMobile("map");
  }
  function onPick(location: Location) {
    setPendingPin(null);
    if (pickTarget === "draft") setDraft((d) => ({ ...d, location }));
    else if (pickTarget?.startsWith("daycare:"))
      updateSettings({
        ...settings,
        daycares: settings.daycares.map((d) =>
          d.id === pickTarget?.slice(8) ? { ...d, location } : d,
        ),
      });
    else {
      const index = settings.people.findIndex((p) => p.id === pickTarget);
      if (index >= 0) updatePerson(index, { work: location });
    }
    setPickTarget(null);
    setMobile("list");
  }
  function openEditor(apartment?: Apartment) {
    previousFocus.current = document.activeElement as HTMLElement;
    setDraft(
      apartment
        ? { ...apartment, daycareId: apartment.daycareId ?? null }
        : emptyDraft(),
    );
    setDraftError("");
    setEditor(true);
    setPickTarget(null);
  }
  function saveApartment(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.location) {
      setDraftError(
        "Select an address, enter coordinates, or choose a pin on the map.",
      );
      return;
    }
    if (draft.url.trim() && !safeUrl(draft.url.trim())) {
      setDraftError("Use a complete http:// or https:// listing URL.");
      return;
    }
    const a: Apartment = {
      ...draft,
      id: draft.id || crypto.randomUUID(),
      label: draft.label.trim() || draft.location.label,
      location: draft.location,
      url: draft.url.trim() ? safeUrl(draft.url.trim())! : "",
    };
    setState((s) => ({
      ...s,
      apartments: draft.id
        ? s.apartments.map((old) => (old.id === draft.id ? a : old))
        : [...s.apartments, a],
    }));
    setEditor(false);
    setPickTarget(null);
    setDraft(emptyDraft());
  }
  async function calculate(refresh = false) {
    setError("");
    if (!state.apartments.length) {
      setError("Add an apartment to start comparing.");
      return;
    }
    if (settings.people.some((p) => !p.work)) {
      setError("Choose a workplace for both people.");
      setSettingsOpen(true);
      return;
    }
    if (
      state.apartments.some(
        (a) =>
          a.daycareId &&
          !settings.daycares.find((d) => d.id === a.daycareId)?.location,
      )
    ) {
      setError(
        "Choose a location for each assigned daycare or select No daycare.",
      );
      return;
    }
    if (!range) {
      setError(
        "SL timetable dates are not available yet. Retry the connection below.",
      );
      return;
    }
    if (settings.date < range.from || settings.date > range.to) {
      setError(`Choose a date between ${range.from} and ${range.to}.`);
      return;
    }
    let deadlines: number[];
    try {
      deadlines = settings.people.map((p) =>
        localTimestamp(settings.date, p.arrival),
      );
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    const id = ++runId.current;
    if (refresh) sl.clear();
    setSnapshot(currentFingerprint);
    setRunning(true);
    setSelected(null);
    const jobs = state.apartments.flatMap((a) =>
      settings.people.map((p, index) => ({
        a,
        p,
        deadline: deadlines[index],
        key: resultKey(a.id, p.id),
      })),
    );
    setResults(
      Object.fromEntries(jobs.map((j) => [j.key, { status: "pending" }])),
    );
    await Promise.all(
      jobs.map(async (job) => {
        try {
          const journey = await calculateCommute(
            sl,
            job.a.location,
            job.p,
            settings,
            job.deadline,
            c.signal,
            job.a.daycareId,
          );
          if (runId.current === id && !c.signal.aborted)
            setResults((r) => ({
              ...r,
              [job.key]: { status: "success", journey },
            }));
        } catch (e) {
          if (runId.current === id)
            setResults((r) => ({
              ...r,
              [job.key]: {
                status: c.signal.aborted ? "cancelled" : "error",
                error: c.signal.aborted
                  ? "Cancelled"
                  : (e as Error).message || "Could not calculate this journey.",
              },
            }));
        }
      }),
    );
    if (runId.current === id) setRunning(false);
  }
  function selectResult(key: string) {
    setSelected(key);
  }
  const completed = Object.values(results).filter(
    (r) => r.status !== "pending",
  ).length;
  const displayResults = stale ? {} : results;
  const ordered = sortedApartments(state.apartments, sort, displayResults);
  return (
    <div className="app-shell">
      <main
        className={`workspace mobile-${mobile}`}
        inert={editor && !pickTarget}
      >
        <aside className="sidebar">
          <section className="settings-section" aria-label="Commute settings">
            <button
              type="button"
              className="section-heading settings-toggle"
              onClick={() => setSettingsOpen(!settingsOpen)}
              aria-expanded={settingsOpen}
            >
              <span>
                <Settings2 size={17} />
                Commute settings
              </span>
              <ChevronDown
                size={17}
                className={settingsOpen ? "" : "collapsed"}
              />
            </button>
            {settingsOpen && (
              <div className="settings-content">
                {settings.people.map((p, i) => (
                  <div className="person-settings" key={p.id}>
                    <div className="person-header">
                      <span className={`person-badge person-${i}`}>
                        {i === 0 ? "A" : "B"}
                      </span>
                      <label className="person-name">
                        <span className="sr-only">Person {i + 1} name</span>
                        <input
                          aria-label={`Person ${i + 1} name`}
                          value={p.name}
                          maxLength={40}
                          onChange={(e) =>
                            updatePerson(i, { name: e.target.value })
                          }
                        />
                      </label>
                      <label className="arrival-input">
                        Arrive by
                        <input
                          type="time"
                          aria-label={`${p.name || `Person ${i + 1}`} arrival time`}
                          value={p.arrival}
                          required
                          onChange={(e) =>
                            updatePerson(i, { arrival: e.target.value })
                          }
                        />
                      </label>
                    </div>
                    <LocationField
                      label={`${p.name || `Person ${i + 1}`} workplace`}
                      value={p.work}
                      onChange={(work) => updatePerson(i, { work })}
                      onPick={() => pick(p.id)}
                    />
                  </div>
                ))}
                <div className="daycare-settings">
                  <div className="section-heading">
                    <span>
                      <Dog size={18} /> Dog daycares
                    </span>
                    <button
                      className="text-button"
                      onClick={() =>
                        updateSettings({
                          ...settings,
                          daycares: [
                            ...settings.daycares,
                            { id: crypto.randomUUID(), location: null },
                          ],
                        })
                      }
                    >
                      <Plus size={14} /> Add daycare
                    </button>
                  </div>
                  {settings.daycares.map((d, i) => (
                    <div key={d.id} className="daycare-entry">
                      <LocationField
                        label={`Dog daycare ${i + 1}`}
                        value={d.location}
                        onChange={(location) =>
                          updateSettings({
                            ...settings,
                            daycares: settings.daycares.map((v) =>
                              v.id === d.id ? { ...v, location } : v,
                            ),
                          })
                        }
                        onPick={() => pick(`daycare:${d.id}`)}
                      />
                      <button
                        className="text-button danger"
                        onClick={() => setDeleteDaycareId(d.id)}
                      >
                        Delete daycare {i + 1}
                      </button>
                      {deleteDaycareId === d.id && (
                        <div className="delete-confirm">
                          <span>
                            Remove daycare and clear its apartment assignments?
                          </span>
                          <button
                            className="text-button danger"
                            onClick={() => {
                              setState((s) => ({
                                ...s,
                                settings: {
                                  ...s.settings,
                                  daycares: s.settings.daycares.filter(
                                    (v) => v.id !== d.id,
                                  ),
                                },
                                apartments: s.apartments.map((a) =>
                                  a.daycareId === d.id
                                    ? { ...a, daycareId: null }
                                    : a,
                                ),
                              }));
                              setDraft((v) =>
                                v.daycareId === d.id
                                  ? { ...v, daycareId: null }
                                  : v,
                              );
                              setDeleteDaycareId(null);
                            }}
                          >
                            Remove daycare
                          </button>
                          <button
                            className="text-button"
                            onClick={() => setDeleteDaycareId(null)}
                          >
                            Keep daycare
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {settings.daycares.length > 0 && (
                    <div className="daycare-expanded">
                      <div className="form-row">
                        <label>
                          Who drops off?
                          <select
                            value={settings.daycare.personId}
                            onChange={(e) =>
                              updateSettings({
                                ...settings,
                                daycare: {
                                  ...settings.daycare,
                                  personId: e.target.value,
                                },
                              })
                            }
                          >
                            {settings.people.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Drop-off minutes
                          <input
                            type="number"
                            min="0"
                            max="120"
                            value={settings.daycare.minutes}
                            onChange={(e) =>
                              updateSettings({
                                ...settings,
                                daycare: {
                                  ...settings.daycare,
                                  minutes: Math.max(
                                    0,
                                    Math.min(
                                      120,
                                      Math.round(Number(e.target.value)),
                                    ),
                                  ),
                                },
                              })
                            }
                          />
                        </label>
                      </div>
                    </div>
                  )}
                </div>
                <div className="date-row">
                  <CalendarDays size={17} />
                  <label htmlFor="commute-date">Commute date</label>
                  <input
                    id="commute-date"
                    type="date"
                    value={settings.date}
                    min={range?.from}
                    max={range?.to}
                    onChange={(e) =>
                      updateSettings({ ...settings, date: e.target.value })
                    }
                  />
                </div>
              </div>
            )}
          </section>
          <section
            className="shortlist-section"
            aria-labelledby="shortlist-heading"
          >
            <div className="section-heading">
              <span id="shortlist-heading">
                <House size={17} />
                Your shortlist{" "}
                <span className="count">{state.apartments.length}</span>
              </span>
              <button
                className="text-button add-button"
                onClick={() => openEditor()}
              >
                <Plus size={15} />
                Add apartment
              </button>
            </div>
            <div className="mode-switch" aria-label="Travel mode">
              <button
                className={settings.mode === "transit" ? "active" : ""}
                aria-pressed={settings.mode === "transit"}
                onClick={() => updateSettings({ ...settings, mode: "transit" })}
              >
                <TrainFront size={16} />
                Public transit
              </button>
              <button
                className={settings.mode === "walking" ? "active" : ""}
                aria-pressed={settings.mode === "walking"}
                onClick={() => updateSettings({ ...settings, mode: "walking" })}
              >
                <Footprints size={16} />
                Walking only
              </button>
            </div>
            <div className="calculate-row">
              <button
                className="button primary calculate"
                disabled={running}
                onClick={() => void calculate()}
              >
                <Route size={16} />
                {running
                  ? `Calculating ${completed}/${Object.keys(results).length}`
                  : "Calculate commutes"}
                {!running && <ArrowRight size={17} />}
              </button>
              {running ? (
                <button
                  className="button secondary"
                  onClick={() => controller.current?.abort()}
                >
                  Cancel
                </button>
              ) : (
                <button
                  className="button secondary refresh"
                  aria-label="Refresh commutes"
                  title="Refresh commutes, ignoring cached results"
                  onClick={() => void calculate(true)}
                >
                  <RefreshCw size={17} />
                </button>
              )}
            </div>
            {running && (
              <progress
                aria-label="Calculation progress"
                value={completed}
                max={Object.keys(results).length}
              />
            )}
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            {stale && (
              <p className="notice" role="status">
                Settings changed. Calculate again for updated commutes.
              </p>
            )}
            {state.apartments.length > 0 && (
              <label className="sort-row">
                <ArrowDownUp size={13} />
                Sort by
                <select
                  aria-label="Sort apartments"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="">Order added</option>
                  {settings.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}’s commute
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="apartment-list">
              {ordered.map((a) => (
                <article
                  key={a.id}
                  className={`apartment-card ${selectedApartment === a.id ? "selected-card" : ""}`}
                >
                  <div className="apartment-heading">
                    <span className="apartment-number">
                      {state.apartments.findIndex((v) => v.id === a.id) + 1}
                    </span>
                    <div>
                      <h2>{a.label}</h2>
                      <p>{a.location.label}</p>
                    </div>
                    <button
                      className="icon-button"
                      aria-label={`Edit ${a.label}`}
                      onClick={() => openEditor(a)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Delete ${a.label}`}
                      onClick={() => setDeleteId(a.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {deleteId === a.id && (
                    <div className="delete-confirm">
                      <span>Remove this apartment?</span>
                      <button
                        className="text-button danger"
                        onClick={() => {
                          setState((s) => ({
                            ...s,
                            apartments: s.apartments.filter(
                              (v) => v.id !== a.id,
                            ),
                          }));
                          setDeleteId(null);
                        }}
                      >
                        Remove
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setDeleteId(null)}
                      >
                        Keep
                      </button>
                    </div>
                  )}
                  <DaycareSelect
                    settings={settings}
                    value={a.daycareId}
                    label={`Daycare for ${a.label}`}
                    onChange={(daycareId) =>
                      setState((s) => ({
                        ...s,
                        apartments: s.apartments.map((v) =>
                          v.id === a.id ? { ...v, daycareId } : v,
                        ),
                      }))
                    }
                  />
                  <div className="commute-grid">
                    {settings.people.map((p, i) => {
                      const key = resultKey(a.id, p.id),
                        r = displayResults[key];
                      return (
                        <button
                          key={p.id}
                          className={`commute-cell ${selected === key && !stale ? "selected-cell" : ""}`}
                          onClick={() => selectResult(key)}
                          aria-label={`Show ${p.name} route for ${a.label}`}
                        >
                          <span className="commute-name">
                            <span className={`tiny-dot dot-${i}`} />
                            {p.name}
                            {a.daycareId &&
                              settings.daycare.personId === p.id && (
                                <Dog size={12} aria-label="Via daycare" />
                              )}
                          </span>
                          {r?.status === "success" ? (
                            <>
                              <strong>{duration(r.journey!.minutes)}</strong>
                              <span>
                                Leave {clock(r.journey!.departure)} · Arrive{" "}
                                {clock(r.journey!.arrival)}
                              </span>
                              <span>
                                {r.journey!.walkingMinutes} min walk ·{" "}
                                {r.journey!.transfers} transfers
                              </span>
                              <span className="timing-label">
                                {r.journey!.realtime
                                  ? "Includes realtime estimates"
                                  : "Scheduled times"}
                              </span>
                            </>
                          ) : (
                            <>
                              <strong className="empty-time">
                                {r?.status === "pending" ? "…" : "—"}
                              </strong>
                              <span>
                                {stale
                                  ? "Needs recalculation"
                                  : r?.status === "error"
                                    ? r.error
                                    : r?.status === "cancelled"
                                      ? "Cancelled"
                                      : "Ready to compare"}
                              </span>
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {a.notes && <p className="apartment-notes">{a.notes}</p>}
                  {safeUrl(a.url) && (
                    <a
                      className="listing-link"
                      href={safeUrl(a.url)!}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View listing
                      <ExternalLink size={12} />
                    </a>
                  )}
                </article>
              ))}
            </div>
            {!state.apartments.length && (
              <div className="empty-state">
                <button
                  className="button secondary"
                  onClick={() => openEditor()}
                >
                  <Plus size={15} />
                  Add your first apartment
                </button>
              </div>
            )}
          </section>
          <footer className="sidebar-footer">
            <details>
              <summary>
                <Info size={14} />
                About your data & this map
              </summary>
              <p>
                Settings and apartments stay in this browser. No accounts,
                sharing, or analytics. SL receives your address searches and
                route locations; OpenStreetMap receives map requests. Listing
                links open the original website.
              </p>
              <p>
                Times are estimates, not guarantees. Check SL before travelling.
                Walking-only routes are limited to 120 minutes per leg.
              </p>
              {range && (
                <p>
                  SL timetable: {range.from} – {range.to}. All times
                  Europe/Stockholm.
                </p>
              )}
              <a
                href="https://www.trafiklab.se/api/other-apis/sl/journey-planner-2/"
                target="_blank"
                rel="noreferrer"
              >
                Powered by SL open data
              </a>
            </details>
            {rangeError && (
              <p className="notice error" role="status">
                {rangeError}{" "}
                <button
                  className="text-button"
                  onClick={() => {
                    sl.clear();
                    setRangeRetry((n) => n + 1);
                  }}
                >
                  Retry SL connection
                </button>
              </p>
            )}
            {storageWarning && (
              <p className="notice" role="status">
                {storageWarning}
              </p>
            )}
          </footer>
        </aside>
        <section className="map-panel" aria-label="Map and selected route">
          <CommuteMap
            settings={settings}
            apartments={state.apartments}
            selectedApartment={selectedApartment}
            journey={selectedJourney}
            pickTarget={pickTarget}
            draft={pickTarget ? pendingPin : editor ? draft.location : null}
            onPick={setPendingPin}
            onSelect={(id) => {
              setSelected(resultKey(id, settings.people[0].id));
            }}
          />
          <div className="map-legend">
            <span>
              <i className="legend-dot home-dot" />
              Apartments
            </span>
            <span>
              <i className="legend-dot work-dot" />
              Workplaces
            </span>
            <span>
              <i className="legend-dot daycare-dot" />
              Dog daycare
            </span>
          </div>
          {pickTarget && (
            <div className="pick-banner" role="status">
              <MapPin size={18} />
              <span>
                {pendingPin ? "Pin placed for " : "Click the map to set "}
                {pickTarget === "draft"
                  ? "the apartment"
                  : pickTarget?.startsWith("daycare:")
                    ? "daycare"
                    : "the workplace"}
                .
                <small>
                  {pendingPin
                    ? "Move the pin by clicking elsewhere, or confirm below."
                    : "You can also enter coordinates in the location field."}
                </small>
              </span>
              {pendingPin && (
                <button
                  className="button primary small"
                  onClick={() => onPick(pendingPin)}
                >
                  Use location
                </button>
              )}
              <button
                className="icon-button"
                aria-label="Cancel map selection"
                onClick={() => {
                  setPickTarget(null);
                  setMobile("list");
                }}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {selectedJourney && (
            <JourneyDetails
              journey={selectedJourney}
              person={selectedPerson?.name ?? ""}
              apartment={
                state.apartments.find((a) => a.id === selectedApartment)
                  ?.label ?? ""
              }
              onClose={() => setSelected(null)}
            />
          )}
        </section>
      </main>
      <nav
        inert={editor && !pickTarget}
        className="mobile-tabs"
        aria-label="View"
      >
        <button
          className={mobile === "list" ? "active" : ""}
          onClick={() => setMobile("list")}
        >
          <House size={17} />
          Shortlist
        </button>
        <button
          className={mobile === "map" ? "active" : ""}
          onClick={() => setMobile("map")}
        >
          <MapIcon size={17} />
          Map
        </button>
      </nav>
      {editor && (
        <div
          className={`editor-backdrop ${pickTarget ? "editor-picking" : ""}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setEditor(false);
              setPickTarget(null);
              setDraft(emptyDraft());
            }
          }}
        >
          <section
            className="editor-panel"
            role="dialog"
            aria-modal={!pickTarget}
            aria-labelledby="editor-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setEditor(false);
                setPickTarget(null);
                setDraft(emptyDraft());
              }
            }}
          >
            <div className="editor-heading">
              <div>
                <h2 id="editor-title">
                  {draft.id ? "Edit apartment" : "Add apartment"}
                </h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close apartment editor"
                onClick={() => {
                  setEditor(false);
                  setPickTarget(null);
                  setDraft(emptyDraft());
                }}
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={saveApartment}>
              <label>
                Apartment name
                <input
                  autoFocus
                  placeholder="e.g. The sunny one in Södermalm"
                  value={draft.label}
                  maxLength={120}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, label: e.target.value }))
                  }
                />
              </label>
              <LocationField
                label="Apartment address"
                value={draft.location}
                onChange={(location) => setDraft((d) => ({ ...d, location }))}
                onPick={() => pick("draft")}
              />
              <DaycareSelect
                settings={settings}
                value={draft.daycareId}
                onChange={(daycareId) => setDraft((d) => ({ ...d, daycareId }))}
              />
              <label>
                Listing URL <span className="optional">optional</span>
                <input
                  type="text"
                  placeholder="https://www.booli.se/…"
                  value={draft.url}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, url: e.target.value }))
                  }
                />
              </label>
              <label>
                Notes <span className="optional">optional</span>
                <textarea
                  placeholder="Balcony, viewing on Sunday, close to the park…"
                  value={draft.notes}
                  maxLength={3000}
                  rows={3}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, notes: e.target.value }))
                  }
                />
              </label>
              {draftError && (
                <p className="notice error" role="alert">
                  {draftError}
                </p>
              )}
              <button className="button primary save-apartment" type="submit">
                <Check size={16} />
                {draft.id ? "Save changes" : "Add to shortlist"}
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
function JourneyDetails({
  journey,
  person,
  apartment,
  onClose,
}: {
  journey: Journey;
  person: string;
  apartment: string;
  onClose: () => void;
}) {
  return (
    <section className="journey-details" aria-label="Selected journey">
      <div className="journey-heading">
        <span className="journey-icon">
          <BriefcaseBusiness size={20} />
        </span>
        <div>
          <span className="eyebrow">{person.toUpperCase()}’S MORNING</span>
          <h2>{apartment}</h2>
        </div>
        <strong>{duration(journey.minutes)}</strong>
        <button
          className="icon-button"
          aria-label="Close journey details"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="journey-meta">
        Leave {clock(journey.departure)}
        <ArrowRight size={14} />
        Arrive {clock(journey.arrival)}
        <span>
          {journey.realtime ? "Includes realtime estimates" : "Scheduled times"}
        </span>
      </div>
      <ol className="journey-legs">
        {journey.legs.map((l, i) => (
          <li key={i} className={`leg-${l.mode}`}>
            <span className="leg-time">{clock(l.departure)}</span>
            <span className="leg-icon">
              {l.mode === "walk" ? (
                <Footprints size={15} />
              ) : l.mode === "transit" ? (
                <TrainFront size={15} />
              ) : l.mode === "dropoff" ? (
                <Dog size={15} />
              ) : (
                <span>·</span>
              )}
            </span>
            <div>
              <strong>{l.label}</strong>
              <p>
                {l.mode === "wait" || l.mode === "dropoff"
                  ? l.from
                  : `${l.from} → ${l.to}`}
              </p>
            </div>
            <span>
              {duration(Math.ceil((l.arrival - l.departure) / 60000))}
            </span>
          </li>
        ))}
      </ol>
      {journey.legs.some(
        (l) => ["walk", "transit"].includes(l.mode) && l.geometry.length < 2,
      ) && (
        <p className="geometry-note">
          SL did not provide map geometry for every leg. The itinerary above is
          complete.
        </p>
      )}
    </section>
  );
}

function DaycareSelect({
  settings,
  value,
  onChange,
  label = "Dog daycare",
}: {
  settings: Settings;
  value?: string | null;
  onChange: (id: string | null) => void;
  label?: string;
}) {
  return (
    <label className="daycare-select">
      {label}
      <select
        aria-label={label}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">No daycare</option>
        {settings.daycares.map((d, i) => (
          <option key={d.id} value={d.id}>
            {d.location?.label ?? `Daycare ${i + 1} (choose location)`}
          </option>
        ))}
      </select>
    </label>
  );
}
