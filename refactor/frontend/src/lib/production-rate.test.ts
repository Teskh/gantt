import { describe, expect, it } from "vitest";
import { interpolateRate } from "./production-rate";

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

  it("extrapolates using the nearest segment slope", () => {
    const pointA = { month: new Date(2024, 0, 1), rate: 100, isActive: true };
    const pointB = { month: new Date(2024, 0, 11), rate: 200, isActive: true };
    const slope =
      (pointB.rate - pointA.rate) /
      (pointB.month.getTime() - pointA.month.getTime());
    const before = new Date(pointA.month.getTime() - 5 * msPerDay);
    const expected = pointA.rate + (before.getTime() - pointA.month.getTime()) * slope;

    const value = interpolateRate(before, [pointA, pointB]);
    expect(value).toBeCloseTo(expected, 5);
  });
});
