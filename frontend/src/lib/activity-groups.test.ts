import { describe, expect, it } from "vitest";
import type { ProjectActivityEntry } from "./project-tracking";
import { groupProjectActivity } from "./activity-groups";

const activityAt = (id: number, occurredAt: Date): ProjectActivityEntry => ({
  id,
  kind: "note",
  body: `Nota ${id}`,
  definitionId: null,
  definitionName: null,
  fromOptionId: null,
  fromOptionLabel: null,
  toOptionId: null,
  toOptionLabel: null,
  actorEmail: "user@example.com",
  actorName: null,
  occurredAt: occurredAt.toISOString(),
});

describe("groupProjectActivity", () => {
  it("groups entries into rolling calendar-day ranges and omits empty groups", () => {
    const now = new Date(2026, 6, 23, 12);
    const entries = [
      activityAt(1, new Date(2026, 6, 23, 0)),
      activityAt(2, new Date(2026, 6, 16, 0)),
      activityAt(3, new Date(2026, 6, 15, 23, 59)),
      activityAt(4, new Date(2026, 5, 23, 0)),
      activityAt(5, new Date(2026, 5, 22, 23, 59)),
    ];

    expect(groupProjectActivity(entries, now).map((group) => ({
      key: group.key,
      entryIds: group.entries.map((entry) => entry.id),
    }))).toEqual([
      { key: "today", entryIds: [1] },
      { key: "lastWeek", entryIds: [2] },
      { key: "lastMonth", entryIds: [3, 4] },
      { key: "longAgo", entryIds: [5] },
    ]);
  });

  it("preserves the activity order within each group", () => {
    const now = new Date(2026, 6, 23, 12);
    const entries = [
      activityAt(9, new Date(2026, 6, 22, 18)),
      activityAt(7, new Date(2026, 6, 20, 10)),
    ];

    expect(groupProjectActivity(entries, now)[0].entries.map((entry) => entry.id))
      .toEqual([9, 7]);
  });
});
