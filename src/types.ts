export type Mode = "transit" | "walking";
export interface Location {
  label: string;
  lat: number;
  lng: number;
  slId?: string;
}
export interface Person {
  id: string;
  name: string;
  work: Location | null;
  arrival: string;
}
export interface Apartment {
  id: string;
  label: string;
  location: Location;
  url: string;
  notes: string;
  daycareId?: string | null;
}
export interface Settings {
  people: Person[];
  date: string;
  mode: Mode;
  daycares: { id: string; location: Location | null }[];
  daycare: {
    personId: string;
    minutes: number;
  };
}
export interface SavedState {
  version: 2;
  settings: Settings;
  apartments: Apartment[];
}
export interface Leg {
  mode: "walk" | "transit" | "dropoff" | "wait";
  label: string;
  from: string;
  to: string;
  departure: number;
  arrival: number;
  geometry: [number, number][];
  realtime: boolean;
}
export interface Journey {
  departure: number;
  arrival: number;
  minutes: number;
  walkingMinutes: number;
  transfers: number;
  realtime: boolean;
  legs: Leg[];
}
export interface JourneyQuery {
  origin: Location;
  destination: Location;
  deadline: number;
  mode: Mode;
}
export interface Result {
  status: "pending" | "success" | "error" | "cancelled";
  journey?: Journey;
  error?: string;
}
export type Results = Record<string, Result>;
export const resultKey = (apartmentId: string, personId: string) =>
  `${apartmentId}:${personId}`;
