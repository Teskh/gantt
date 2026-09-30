import { describe, expect, it } from "vitest";
import {
  calculateProductionM2,
  getDailyProductionRate,
  interpolateRate,
  mergeMonthlySeries,
  monthKey,
  parseMonthValue,
} from "./production-rate";

const msPerDay = 24 * 60 * 60 * 1000;

describe("interpolateRate", () => {
  it("returns 0 when no active points exist", () => {
    expect(interpolateRate(new Date(), [])).toBe(0);
  });

  it("returns the single point rate when only one active point exists", () => {
    const points = [{ month: new Date(2024, 0, 1), rate: 120, isActive: true }];
    expect(interpolateRate(new Date(2024, 2, 1), points)).toBe(120);
  });

  it("interpolates linearly between two points", () => {
    const pointA = { month: new Date(2024, 0, 1), rate: 100, isActive: true };
    const pointB = { month: new Date(2024, 0, 11), rate: 200, isActive: true };
    const midpoint = new Date(pointA.month.getTime() + 5 * msPerDay);
    const value = interpolateRate(midpoint, [pointA, pointB]);
    expect(value).toBeCloseTo(150, 5);
  });

  it("keeps the first and last point flat outside the active range", () => {
    const pointA = { month: new Date(2024, 0, 1), rate: 100, isActive: true };
    const pointB = { month: new Date(2024, 0, 11), rate: 200, isActive: true };
    const before = new Date(pointA.month.getTime() - 5 * msPerDay);
    const after = new Date(pointB.month.getTime() + 5 * msPerDay);

    expect(interpolateRate(before, [pointA, pointB])).toBe(100);
    expect(interpolateRate(after, [pointA, pointB])).toBe(200);
  });
});

describe("production capacity helpers", () => {
  it("converts the configured annual production factor into a daily rate", () => {
    const points = [{ month: new Date(2024, 0, 1), rate: 365, isActive: true }];

    expect(getDailyProductionRate(new Date(2024, 0, 1), points)).toBe(250);
  });

  it("sums the capacity in an exclusive date range", () => {
    const points = [{ month: new Date(2024, 0, 1), rate: 365, isActive: true }];

    expect(
      calculateProductionM2(
        new Date(2024, 0, 1),
        new Date(2024, 0, 4),
        points
      )
    ).toBe(750);
  });
});

describe("mergeMonthlySeries", () => {
  it("keeps points outside the edited months and replaces the edited ones", () => {
    const points = [
      { month: new Date(2024, 0, 1), rate: 50, isActive: true },
      { month: new Date(2024, 5, 1), rate: 60, isActive: true },
      { month: new Date(2025, 0, 1), rate: 90, isActive: true },
    ];
    const edited = [
      { month: new Date(2024, 5, 1), rate: 70, isActive: true },
      { month: new Date(2024, 6, 1), rate: 65, isActive: false },
    ];

    expect(mergeMonthlySeries(points, edited)).toEqual([
      points[0],
      edited[0],
      edited[1],
      points[2],
    ]);
  });
});

describe("parseMonthValue", () => {
  it("reads a stored month as that local month and round-trips through monthKey", () => {
    const month = parseMonthValue("2026-09-01");
    expect(month).toEqual(new Date(2026, 8, 1));
    expect(monthKey(month!)).toBe("2026-09-01");
    expect(parseMonthValue("2026-09")).toEqual(new Date(2026, 8, 1));
  });

  it("rejects malformed months", () => {
    expect(parseMonthValue("2026-13")).toBeNull();
    expect(parseMonthValue("garbage")).toBeNull();
  });
});
