import type { ProjectActivityEntry } from "./project-tracking";

export const activityGroupDefinitions = [
  { key: "today", label: "Hoy" },
  { key: "lastWeek", label: "Última semana" },
  { key: "lastMonth", label: "Último mes" },
  { key: "longAgo", label: "Hace mucho tiempo" },
] as const;

export type ActivityGroupKey = (typeof activityGroupDefinitions)[number]["key"];

export interface TimestampedActivity {
  occurredAt: string;
}

export interface ActivityGroup<T extends TimestampedActivity> {
  key: ActivityGroupKey;
  label: string;
  entries: T[];
}

const localDayOffset = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() - days);

export const groupActivityEntries = <T extends TimestampedActivity>(
  entries: T[],
  now = new Date()
): ActivityGroup<T>[] => {
  const todayStart = localDayOffset(now, 0).getTime();
  const lastWeekStart = localDayOffset(now, 7).getTime();
  const lastMonthStart = localDayOffset(now, 30).getTime();
  const entriesByGroup: Record<ActivityGroupKey, T[]> = {
    today: [],
    lastWeek: [],
    lastMonth: [],
    longAgo: [],
  };

  entries.forEach((entry) => {
    const occurredAt = new Date(entry.occurredAt).getTime();
    if (occurredAt >= todayStart) {
      entriesByGroup.today.push(entry);
    } else if (occurredAt >= lastWeekStart) {
      entriesByGroup.lastWeek.push(entry);
    } else if (occurredAt >= lastMonthStart) {
      entriesByGroup.lastMonth.push(entry);
    } else {
      entriesByGroup.longAgo.push(entry);
    }
  });

  return activityGroupDefinitions
    .map(({ key, label }) => ({ key, label, entries: entriesByGroup[key] }))
    .filter((group) => group.entries.length > 0);
};

export type ProjectActivityGroup = ActivityGroup<ProjectActivityEntry>;

export const groupProjectActivity = (
  entries: ProjectActivityEntry[],
  now = new Date()
): ProjectActivityGroup[] => groupActivityEntries(entries, now);
