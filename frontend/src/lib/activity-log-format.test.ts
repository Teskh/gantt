import { describe, expect, it } from "vitest";
import {
  activitySummaryWithoutActor,
  actorInitials,
  formatActivityTimestamp,
} from "./activity-log-format";

describe("actorInitials", () => {
  it("uses the first and last words from the display name", () => {
    expect(actorInitials("John Michael Appleseed", "john@example.com")).toBe("JA");
  });

  it("falls back to a readable email local-part", () => {
    expect(actorInitials(null, "jane.appleseed@example.com")).toBe("JA");
    expect(actorInitials(null, "qa@example.com")).toBe("QA");
  });
});

describe("activitySummaryWithoutActor", () => {
  it("removes the duplicated actor prefix and capitalizes the action", () => {
    expect(activitySummaryWithoutActor(
      "John Appleseed movió el proyecto Norte",
      "John Appleseed",
      "john@example.com"
    )).toBe("Movió el proyecto Norte");
  });

  it("keeps summaries that do not begin with the actor", () => {
    expect(activitySummaryWithoutActor(
      "Se actualizó el proyecto Norte",
      "John Appleseed",
      "john@example.com"
    )).toBe("Se actualizó el proyecto Norte");
  });
});

describe("formatActivityTimestamp", () => {
  it("omits seconds and the current year and uses 24-hour time", () => {
    const now = new Date(2026, 6, 28, 14);
    const value = new Date(2026, 6, 28, 0, 3, 42).toISOString();
    expect(formatActivityTimestamp(value, now)).toBe("28-07, 00:03");
  });

  it("keeps the year for older activity", () => {
    const now = new Date(2026, 6, 28, 14);
    const value = new Date(2025, 10, 9, 23, 7, 59).toISOString();
    expect(formatActivityTimestamp(value, now)).toBe("09-11-2025, 23:07");
  });
});
