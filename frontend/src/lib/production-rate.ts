export interface MonthlyRatePoint {
  month: Date;
  rate: number;
  isActive: boolean;
}

export const normalizeMonth = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), 1);

export const addMonths = (date: Date, amount: number): Date =>
  new Date(date.getFullYear(), date.getMonth() + amount, 1);

export const monthKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;

export const formatMonthLabel = (date: Date): string =>
  date.toLocaleDateString(undefined, { month: "short", year: "numeric" });

export const sortByMonth = (a: MonthlyRatePoint, b: MonthlyRatePoint): number =>
  a.month.getTime() - b.month.getTime();

export const getActivePoints = (points: MonthlyRatePoint[]): MonthlyRatePoint[] =>
  points.filter((point) => point.isActive).sort(sortByMonth);

export const interpolateRate = (
  date: Date,
  activePoints: MonthlyRatePoint[]
): number => {
  if (activePoints.length === 0) return 0;
  if (activePoints.length === 1) return Math.max(0, activePoints[0].rate);

  const sorted = [...activePoints].sort(sortByMonth);
  const time = date.getTime();

  const first = sorted[0];
  if (time <= first.month.getTime()) {
    return Math.max(0, first.rate);
  }

  const last = sorted[sorted.length - 1];
  if (time >= last.month.getTime()) {
    return Math.max(0, last.rate);
  }

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const pointA = sorted[i];
    const pointB = sorted[i + 1];
    if (
      time >= pointA.month.getTime() &&
      time <= pointB.month.getTime()
    ) {
      const t1 = pointA.month.getTime();
      const t2 = pointB.month.getTime();
      const ratio = t2 === t1 ? 0 : (time - t1) / (t2 - t1);
      return Math.max(0, pointA.rate + ratio * (pointB.rate - pointA.rate));
    }
  }

  return 0;
};

export const buildMonthlySeries = (
  points: MonthlyRatePoint[],
  startMonth: Date,
  endMonth: Date
): MonthlyRatePoint[] => {
  const normalizedStart = normalizeMonth(startMonth);
  const normalizedEnd = normalizeMonth(endMonth);

  const pointMap = new Map(
    points.map((point) => [monthKey(normalizeMonth(point.month)), point])
  );
  const activePoints = getActivePoints(points).map((point) => ({
    ...point,
    month: normalizeMonth(point.month),
  }));

  const series: MonthlyRatePoint[] = [];
  let cursor = new Date(normalizedStart);

  while (cursor.getTime() <= normalizedEnd.getTime()) {
    const key = monthKey(cursor);
    const existing = pointMap.get(key);
    const computedRate = interpolateRate(cursor, activePoints);

    series.push({
      month: new Date(cursor),
      rate: existing?.isActive ? existing.rate : computedRate,
      isActive: existing?.isActive ?? false,
    });

    cursor = addMonths(cursor, 1);
  }

  return series;
};

export const serializeMonth = (date: Date): string => monthKey(date);
