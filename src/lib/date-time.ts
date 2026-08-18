export function canonicalTimeZone(value: string) {
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: candidate }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function formatDateTime(value: string | number | Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("zh-CN", { ...options, timeZone }).format(new Date(value));
}

export function hourInTimeZone(value: string | number | Date, timeZone: string) {
  const hour = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(new Date(value)).find((part) => part.type === "hour")?.value;
  return Number(hour);
}
