import { describe, expect, it } from "vitest";
import { canonicalTimeZone, formatDateTime, hourInTimeZone } from "@/lib/date-time";

describe("time zone formatting", () => {
  it("formats timestamps and hourly buckets in the configured IANA time zone", () => {
    const timestamp = "2026-08-17T13:19:44.000Z";
    expect(formatDateTime(timestamp, "Asia/Shanghai", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })).toContain("21:19:44");
    expect(hourInTimeZone(timestamp, "Asia/Shanghai")).toBe(21);
    expect(hourInTimeZone(timestamp, "UTC")).toBe(13);
  });

  it("canonicalizes valid zones and rejects invalid values", () => {
    expect(canonicalTimeZone(" Asia/Shanghai ")).toBe("Asia/Shanghai");
    expect(canonicalTimeZone("Not/A_Time_Zone")).toBeNull();
    expect(canonicalTimeZone(" ")).toBeNull();
  });
});
