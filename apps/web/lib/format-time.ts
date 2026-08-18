export function formatCacherDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  }).format(new Date(value));
}
