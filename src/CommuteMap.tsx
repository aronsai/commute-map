import { useEffect, useRef } from "react";
import L from "leaflet";
import type { Apartment, Journey, Location, Settings } from "./types";
interface Props {
  settings: Settings;
  apartments: Apartment[];
  selectedApartment: string | null;
  journey?: Journey;
  pickTarget: string | null;
  draft: Location | null;
  onPick: (location: Location) => void;
  onSelect: (id: string) => void;
}
export default function CommuteMap(props: Props) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markerLayer = useRef<L.LayerGroup | null>(null);
  const routeLayer = useRef<L.LayerGroup | null>(null);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const m = L.map(element.current!, { zoomControl: false }).setView(
      [59.3293, 18.0686],
      12,
    );
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    L.control.zoom({ position: "bottomright" }).addTo(m);
    markerLayer.current = L.layerGroup().addTo(m);
    routeLayer.current = L.layerGroup().addTo(m);
    map.current = m;
    m.on("click", (e) => {
      if (latest.current.pickTarget)
        latest.current.onPick({
          label: `Map pin · ${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`,
          lat: e.latlng.lat,
          lng: e.latlng.lng,
        });
    });
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(element.current!);
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const group = markerLayer.current;
    if (!group) return;
    group.clearLayers();
    function marker(
      location: Location,
      text: string,
      kind: string,
      title: string,
      click?: () => void,
    ) {
      const icon = L.divIcon({
        className: `map-pin ${kind}`,
        html: `<span>${text}</span>`,
        iconSize: [34, 40],
        iconAnchor: [17, 40],
      });
      const m = L.marker([location.lat, location.lng], {
        icon,
        title,
        keyboard: true,
      }).addTo(group!);
      const tooltip = document.createElement("span");
      tooltip.textContent = title;
      m.bindTooltip(tooltip, { direction: "top", offset: [0, -36] });
      if (click) m.on("click", click);
    }
    props.settings.people.forEach((p, i) => {
      if (p.work)
        marker(
          p.work,
          i === 0 ? "A" : "B",
          i === 0 ? "work-a" : "work-b",
          `${p.name}: ${p.work.label}`,
        );
    });
    props.settings.daycares.forEach((d) => {
      if (d.location)
        marker(d.location, "D", "daycare", `Daycare: ${d.location.label}`);
    });
    props.apartments.forEach((a, i) =>
      marker(
        a.location,
        String(i + 1),
        `home ${props.selectedApartment === a.id ? "selected" : ""}`,
        a.label,
        () => latest.current.onSelect(a.id),
      ),
    );
    if (props.draft) marker(props.draft, "+", "draft", props.draft.label);
  }, [props.settings, props.apartments, props.selectedApartment, props.draft]);
  useEffect(() => {
    const group = routeLayer.current;
    if (!group) return;
    group.clearLayers();
    const points: [number, number][] = [];
    props.journey?.legs.forEach((l) => {
      if (l.geometry.length > 1) {
        L.polyline(l.geometry, {
          color: l.mode === "walk" ? "#687a68" : "#285bdb",
          weight: l.mode === "walk" ? 4 : 5,
          opacity: 0.9,
          dashArray: l.mode === "walk" ? "5 8" : undefined,
        }).addTo(group);
        points.push(...l.geometry);
      }
    });
    const apartment = props.apartments.find(
      (a) => a.id === props.selectedApartment,
    );
    if (points.length)
      map.current?.fitBounds(L.latLngBounds(points), {
        padding: [55, 55],
        maxZoom: 15,
      });
    else if (apartment)
      map.current?.setView(
        [apartment.location.lat, apartment.location.lng],
        14,
      );
  }, [props.journey, props.selectedApartment, props.apartments]);
  return (
    <div
      ref={element}
      className={`leaflet-map ${props.pickTarget ? "picking" : ""}`}
      aria-label="Stockholm commute map"
    />
  );
}
