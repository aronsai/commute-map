const zone = "Europe/Stockholm";
export function stockholmParts(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}
export function localTimestamp(date: string, time: string): number {
  const target = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(target))
    throw new Error("Choose a valid date and time.");
  let candidate = target;
  for (let i = 0; i < 4; i++) {
    const p = stockholmParts(candidate);
    const offset = Date.parse(`${p.date}T${p.time}:00Z`) - candidate;
    candidate = target - offset;
  }
  const p = stockholmParts(candidate);
  if (p.date !== date || p.time !== time)
    throw new Error(
      "That time does not exist in Stockholm because of the clock change.",
    );
  return candidate;
}
export const clock = (timestamp: number) => stockholmParts(timestamp).time;
export function nextWeekday(
  now = Date.now(),
  min?: string,
  max?: string,
): string {
  let date = stockholmParts(now).date;
  const advance = (d: string) =>
    new Date(Date.parse(`${d}T12:00:00Z`) + 86400000)
      .toISOString()
      .slice(0, 10);
  date = advance(date);
  if (min && date < min) date = min;
  while ([0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay()))
    date = advance(date);
  if (max && date > max) return max;
  return date;
}
export const duration = (minutes: number) =>
  minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    : `${minutes} min`;
