"use client";

import { createContext, useContext } from "react";

const TimeZoneContext = createContext<string | null>(null);

export function TimeZoneProvider({ timeZone, children }: { timeZone: string; children: React.ReactNode }) {
  return <TimeZoneContext.Provider value={timeZone}>{children}</TimeZoneContext.Provider>;
}

export function useTimeZone() {
  const timeZone = useContext(TimeZoneContext);
  if (!timeZone) throw new Error("TIME_ZONE_PROVIDER_REQUIRED");
  return timeZone;
}
