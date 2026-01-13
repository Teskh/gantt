import React, { useMemo, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { ProductionRatePoint } from "../App";
import {
  buildMonthlySeries,
  formatMonthLabel,
  monthKey,
} from "@/lib/production-rate";

interface ProductionRateMonthlyProps {
  points: ProductionRatePoint[];
  onPointsChange: (points: ProductionRatePoint[]) => void;
  onPointsSave?: (points: ProductionRatePoint[]) => void;
  minMonth: Date;
  maxMonth: Date;
  minRate: number;
  maxRate: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const chartHeight = 220;
const chartPaddingX = 48;
const chartPaddingY = 18;
const pointSpacing = 96;
const minChartWidth = 520;

export const ProductionRateMonthly: React.FC<ProductionRateMonthlyProps> = ({
  points,
  onPointsChange,
  onPointsSave,
  minMonth,
  maxMonth,
  minRate,
  maxRate,
}) => {
  const series = useMemo(
    () => buildMonthlySeries(points, minMonth, maxMonth),
    [points, minMonth, maxMonth]
  );
  const hasActive = series.some((point) => point.isActive);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    if (series.length === 0) return;
    if (!selectedKey || !series.some((point) => monthKey(point.month) === selectedKey)) {
      setSelectedKey(monthKey(series[0].month));
    }
  }, [series, selectedKey]);

  const selectedPoint =
    series.find((point) => monthKey(point.month) === selectedKey) ?? series[0];

  const handleToggle = (key: string) => {
    const updated = series.map((point) =>
      monthKey(point.month) === key
        ? { ...point, isActive: !point.isActive }
        : point
    );
    onPointsChange(updated);
    onPointsSave?.(updated);
  };

  const handleRateChange = (key: string, value: string) => {
    const raw = Number(value);
    const nextRate = Number.isNaN(raw)
      ? 0
      : Math.min(maxRate, Math.max(minRate, raw));
    const updated = series.map((point) =>
      monthKey(point.month) === key ? { ...point, rate: nextRate } : point
    );
    onPointsChange(updated);
  };

  const handleRateSave = () => {
    onPointsSave?.(series);
  };

  const rateSpan = Math.max(1, maxRate - minRate);
  const plotHeight = chartHeight - chartPaddingY * 2;
  const baselineY = chartHeight - chartPaddingY;
  const chartWidth = Math.max(
    minChartWidth,
    chartPaddingX * 2 + Math.max(0, series.length - 1) * pointSpacing
  );

  const chartPoints = series.map((point, index) => {
    const x = chartPaddingX + index * pointSpacing;
    const normalized = clamp((point.rate - minRate) / rateSpan, 0, 1);
    const y = chartPaddingY + (1 - normalized) * plotHeight;
    return { ...point, x, y, key: monthKey(point.month) };
  });

  const linePoints = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const polygonPoints =
    chartPoints.length > 0
      ? `${chartPoints[0].x},${baselineY} ${linePoints} ${chartPoints[chartPoints.length - 1].x},${baselineY}`
      : "";

  return (
    <div className="relative space-y-3">
      <div className="relative overflow-x-auto rounded border border-border bg-background/50 shadow-sm grid-bg">
        <div className="absolute left-3 top-3 z-10 text-[10px] font-bold uppercase tracking-wide text-amber-600">
          CAPACITY_CURVE [units/period]
        </div>
        <div className="py-8" style={{ width: chartWidth, minWidth: "100%" }}>
          <svg
            width={chartWidth}
            height={chartHeight}
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            preserveAspectRatio="none"
            className="block"
          >
            {[0.25, 0.5, 0.75].map((ratio) => {
              const y = chartPaddingY + plotHeight * ratio;
              return (
                <line
                  key={ratio}
                  x1={0}
                  y1={y}
                  x2={chartWidth}
                  y2={y}
                  stroke="var(--gantt-line)"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}

            {polygonPoints && (
              <polygon
                points={polygonPoints}
                fill="var(--chart-1)"
                fillOpacity={0.1}
              />
            )}

            {linePoints && (
              <polyline
                points={linePoints}
                fill="none"
                stroke="var(--chart-1)"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            )}

            {chartPoints.map((point) => {
              const size = point.isActive ? 12 : 8;
              const isSelected = point.key === selectedKey;
              const fill = point.isActive
                ? isSelected
                  ? "var(--chart-1)"
                  : "var(--card)"
                : "transparent";
              const strokeOpacity = point.isActive ? 1 : 0.6;

              return (
                <rect
                  key={point.key}
                  x={point.x - size / 2}
                  y={point.y - size / 2}
                  width={size}
                  height={size}
                  rx={2}
                  fill={fill}
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  strokeOpacity={strokeOpacity}
                  className="cursor-pointer transition-colors"
                  onClick={() => setSelectedKey(point.key)}
                />
              );
            })}
          </svg>
          <div className="relative mt-2 h-10 text-[10px] uppercase text-muted-foreground">
            {chartPoints.map((point) => (
              <button
                key={point.key}
                type="button"
                onClick={() => setSelectedKey(point.key)}
                className={cn(
                  "absolute top-0 flex w-[96px] -translate-x-1/2 flex-col items-center gap-1 text-center transition-colors",
                  point.key === selectedKey
                    ? "text-amber-600"
                    : "text-muted-foreground hover:text-foreground"
                )}
                style={{ left: point.x }}
              >
                <span
                  className={cn(
                    "h-1 w-6 rounded-full",
                    point.isActive ? "bg-amber-500" : "bg-muted"
                  )}
                />
                <span>{formatMonthLabel(point.month)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {selectedPoint && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-border bg-background/80 px-3 py-2 text-[11px] uppercase tracking-wide">
          <div className="text-muted-foreground">Month</div>
          <div className="text-xs font-semibold text-foreground">
            {formatMonthLabel(selectedPoint.month)}
          </div>
          <button
            type="button"
            onClick={() => handleToggle(monthKey(selectedPoint.month))}
            className={cn(
              "rounded border px-2 py-1 text-[10px] font-bold uppercase transition-colors",
              selectedPoint.isActive
                ? "border-amber-500/70 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {selectedPoint.isActive ? "Active" : "Inactive"}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Rate</span>
            <input
              type="number"
              min={minRate}
              max={maxRate}
              value={Number.isFinite(selectedPoint.rate) ? selectedPoint.rate : 0}
              onChange={(e) =>
                handleRateChange(monthKey(selectedPoint.month), e.target.value)
              }
              onBlur={handleRateSave}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              disabled={!selectedPoint.isActive}
              className={cn(
                "w-28 rounded border bg-background px-2 py-1 text-xs font-semibold text-foreground outline-none transition-opacity focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30",
                !selectedPoint.isActive && "opacity-60"
              )}
            />
          </div>
          <div className="w-full text-[10px] text-muted-foreground normal-case">
            Inactive months interpolate linearly from active points.
            {!hasActive && (
              <span className="ml-2 text-amber-600">
                Activate at least one month to calculate the plan.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
