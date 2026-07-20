import { describe, expect, it } from "vitest";
import {
  canApplyScenarioSnapshot,
  isCurrentOrNewerRevision,
  isStrictlyNewerRevision,
} from "./sync";

describe("canApplyScenarioSnapshot", () => {
  it("accepts equal and newer revisions for the active scenario", () => {
    const current = { id: 3, revision: 7 };

    expect(canApplyScenarioSnapshot(current, { id: 3, revision: 7 })).toBe(true);
    expect(canApplyScenarioSnapshot(current, { id: 3, revision: 8 })).toBe(true);
  });

  it("rejects older revisions and snapshots from another scenario", () => {
    const current = { id: 3, revision: 7 };

    expect(canApplyScenarioSnapshot(current, { id: 3, revision: 6 })).toBe(false);
    expect(canApplyScenarioSnapshot(current, { id: 4, revision: 8 })).toBe(false);
    expect(canApplyScenarioSnapshot(null, { id: 3, revision: 8 })).toBe(false);
  });
});

describe("isCurrentOrNewerRevision", () => {
  it("allows initial, equal, and newer values but rejects stale values", () => {
    expect(isCurrentOrNewerRevision(null, 0)).toBe(true);
    expect(isCurrentOrNewerRevision(4, 4)).toBe(true);
    expect(isCurrentOrNewerRevision(4, 5)).toBe(true);
    expect(isCurrentOrNewerRevision(4, 3)).toBe(false);
  });
});

describe("isStrictlyNewerRevision", () => {
  it("allows the initial value and newer revisions without reapplying equal revisions", () => {
    expect(isStrictlyNewerRevision(null, 0)).toBe(true);
    expect(isStrictlyNewerRevision(4, 4)).toBe(false);
    expect(isStrictlyNewerRevision(4, 5)).toBe(true);
    expect(isStrictlyNewerRevision(4, 3)).toBe(false);
  });
});
