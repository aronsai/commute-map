import { useEffect, useId, useState } from "react";
import { MapPin, Search, X } from "lucide-react";
import type { Location } from "./types";
import { sl } from "./sl";
interface Props {
  label: string;
  value: Location | null;
  onChange: (value: Location | null) => void;
  onPick: () => void;
}
export default function LocationField({
  label,
  value,
  onChange,
  onPick,
}: Props) {
  const id = useId();
  const [text, setText] = useState(value?.label ?? "");
  const [suggestions, setSuggestions] = useState<Location[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [coords, setCoords] = useState({
    lat: String(value?.lat ?? ""),
    lng: String(value?.lng ?? ""),
  });
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (value) setText(value.label);
    setCoords({ lat: String(value?.lat ?? ""), lng: String(value?.lng ?? "") });
  }, [value]);
  useEffect(() => {
    if (text.trim().length < 3 || text === value?.label || !focused) {
      setSuggestions([]);
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      setMessage("");
      sl.search(text, controller.signal)
        .then((results) => {
          setSuggestions(results.slice(0, 7));
          setMessage(
            results.length
              ? ""
              : "No matches. Try a street and Stockholm, or choose on the map.",
          );
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setMessage(error.message || "Address search failed.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, value?.label, focused]);
  function choose(location: Location) {
    onChange(location);
    setText(location.label);
    setSuggestions([]);
    setMessage("");
    setFocused(false);
  }
  function applyCoordinates() {
    const lat = Number(coords.lat),
      lng = Number(coords.lng);
    if (
      !coords.lat.trim() ||
      !coords.lng.trim() ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      setMessage(
        "Enter valid latitude (−90 to 90) and longitude (−180 to 180).",
      );
      return;
    }
    choose({
      label: text.trim() || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      lat,
      lng,
    });
  }
  return (
    <div className="location-field">
      <label htmlFor={id}>{label}</label>
      <div className={`search-input ${value ? "is-selected" : ""}`}>
        <Search size={15} aria-hidden="true" />
        <input
          id={id}
          autoComplete="off"
          value={text}
          placeholder="Search an address or place"
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            setText(e.target.value);
            if (value) onChange(null);
            setFocused(true);
          }}
          aria-describedby={`${id}-help`}
          aria-expanded={suggestions.length > 0}
          aria-controls={`${id}-suggestions`}
        />
        {value && (
          <button
            type="button"
            className="icon-button"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => {
              onChange(null);
              setText("");
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {suggestions.length > 0 && (
        <ul
          id={`${id}-suggestions`}
          className="suggestions"
          aria-label={`${label} suggestions`}
        >
          {suggestions.map((l, i) => (
            <li key={`${l.slId}-${i}`}>
              <button type="button" onClick={() => choose(l)}>
                <MapPin size={14} />
                <span>{l.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div id={`${id}-help`} className="location-help">
        {busy ? (
          "Searching SL…"
        ) : value ? (
          <span className="confirmed">✓ Location selected</span>
        ) : (
          "Select a search result or set a pin."
        )}
        <button type="button" className="text-button" onClick={onPick}>
          <MapPin size={12} />
          Choose on map
        </button>
      </div>
      {message && (
        <p className="field-message" role="status">
          {message}
        </p>
      )}
      <details className="coordinates">
        <summary>Enter or adjust coordinates</summary>
        <div className="coordinate-inputs">
          <label>
            Latitude
            <input
              aria-label={`${label} latitude`}
              type="number"
              step="any"
              value={coords.lat}
              onChange={(e) => setCoords({ ...coords, lat: e.target.value })}
            />
          </label>
          <label>
            Longitude
            <input
              aria-label={`${label} longitude`}
              type="number"
              step="any"
              value={coords.lng}
              onChange={(e) => setCoords({ ...coords, lng: e.target.value })}
            />
          </label>
          <button
            type="button"
            className="button small secondary"
            onClick={applyCoordinates}
          >
            Set location
          </button>
        </div>
      </details>
    </div>
  );
}
