import React, { useMemo, useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { ProductionRatePoint } from "../App";
import { buildMonthlySeries, monthKey } from "@/lib/production-rate";

interface ProductionRateMonthlyProps {
  points: ProductionRatePoint[];
  onPointsChange: (points: ProductionRatePoint[]) => void;
  onPointsSave?: (points: ProductionRatePoint[]) => void;
  minMonth: Date;
  maxMonth: Date;
  minRate: number;
  maxRate: number;
  rateView: "daily" | "weekly" | "monthly" | "yearly";
  onRateViewChange: (view: "daily" | "weekly" | "monthly" | "yearly") => void;
  monthPositions: Array<{ key: string; date: Date; width: number; x: number }>;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const chartHeight = 240;
const chartPaddingY = 18;
const chartBottomPadding = 0;

export const ProductionRateMonthly: React.FC<ProductionRateMonthlyProps> = ({
  points,
  onPointsChange,
  onPointsSave,
  minMonth,
  maxMonth,
  minRate,
  maxRate,
  rateView,
  onRateViewChange,
  monthPositions,
}) => {
  const series = useMemo(
    () => buildMonthlySeries(points, minMonth, maxMonth),
    [points, minMonth, maxMonth]
  );
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const lastUpdatedRef = useRef<ProductionRatePoint[] | null>(null);

  const rateSpan = Math.max(1, maxRate - minRate);
  const plotHeight = chartHeight - chartPaddingY - chartBottomPadding;
  const baselineY = chartHeight - chartBottomPadding;
  const chartWidth = useMemo(
    () => monthPositions.reduce((sum, pos) => sum + pos.width, 0),
    [monthPositions]
  );
  const safeChartWidth = Math.max(1, chartWidth);

  const positionMap = useMemo(() => {
    return new Map(monthPositions.map((pos) => [pos.key, pos.x]));
  }, [monthPositions]);

  const chartPoints = useMemo(() => {
    return series
      .map((point) => {
        const key = monthKey(point.month);
        const x = positionMap.get(key);
        if (x === undefined) return null;
        const normalized = clamp((point.rate - minRate) / rateSpan, 0, 1);
        const y = chartPaddingY + (1 - normalized) * plotHeight;
        return { ...point, x, y, key };
      })
      .filter((point): point is NonNullable<typeof point> => point !== null);
  }, [series, minRate, rateSpan, plotHeight, positionMap]);

  const extendedPoints = useMemo(() => {
    if (chartPoints.length === 0) return [];

    const clampY = (value: number) =>
      clamp(value, chartPaddingY, chartPaddingY + plotHeight);

    const basePoints = chartPoints.map((point) => ({
      x: point.x,
      y: point.y,
    }));

    if (basePoints.length === 1) {
      const y = clampY(basePoints[0].y);
      return [
        { x: 0, y },
        basePoints[0],
        { x: safeChartWidth, y },
      ];
    }

    const first = basePoints[0];
    const second = basePoints[1];
    const last = basePoints[basePoints.length - 1];
    const penultimate = basePoints[basePoints.length - 2];

    const leftSlope =
      second.x !== first.x ? (second.y - first.y) / (second.x - first.x) : 0;
    const rightSlope =
      last.x !== penultimate.x
        ? (last.y - penultimate.y) / (last.x - penultimate.x)
        : 0;

    const leftY = clampY(first.y - leftSlope * first.x);
    const rightY = clampY(last.y + rightSlope * (safeChartWidth - last.x));

    const extended = [...basePoints];
    if (first.x > 0.5) {
      extended.unshift({ x: 0, y: leftY });
    }
    if (last.x < safeChartWidth - 0.5) {
      extended.push({ x: safeChartWidth, y: rightY });
    }

    return extended;
  }, [chartPoints, plotHeight, safeChartWidth]);

  const linePoints = extendedPoints
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
  const polygonPoints =
    extendedPoints.length > 0
      ? `${extendedPoints[0].x},${baselineY} ${linePoints} ${extendedPoints[extendedPoints.length - 1].x},${baselineY}`
      : "";

  const rateFromClientY = useCallback(
    (clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return minRate;
      const localY = clientY - rect.top;
      const clampedY = clamp(localY, chartPaddingY, chartPaddingY + plotHeight);
      const normalized = 1 - (clampedY - chartPaddingY) / plotHeight;
      const raw = minRate + normalized * rateSpan;
      return Math.min(maxRate, Math.max(minRate, Math.round(raw)));
    },
    [minRate, maxRate, plotHeight, rateSpan]
  );

  const applyRateChange = useCallback(
    (key: string, clientY: number) => {
      const nextRate = rateFromClientY(clientY);
      const base = lastUpdatedRef.current ?? series;
      const updated = base.map((point) =>
        monthKey(point.month) === key
          ? { ...point, rate: nextRate, isActive: true }
          : point
      );
      lastUpdatedRef.current = updated;
      onPointsChange(updated);
    },
    [rateFromClientY, series, onPointsChange]
  );

  const finishDrag = useCallback(() => {
    setDraggingKey(null);
    setHoveredKey(null);
    if (lastUpdatedRef.current) {
      onPointsSave?.(lastUpdatedRef.current);
    }
    lastUpdatedRef.current = null;
  }, [onPointsSave]);

  useEffect(() => {
    if (!draggingKey) return;
    const handlePointerMove = (event: PointerEvent) => {
      applyRateChange(draggingKey, event.clientY);
    };
    const handlePointerUp = () => finishDrag();
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [draggingKey, applyRateChange, finishDrag]);

  useEffect(() => {
    if (!draggingKey) {
      lastUpdatedRef.current = null;
    }
  }, [series, draggingKey]);

  const unitLabel =
    rateView === "daily"
      ? "m2/dia"
      : rateView === "weekly"
        ? "m2/semana"
        : rateView === "monthly"
          ? "m2/mes"
          : "m2/año";

  return (
    <div
      className="relative w-full border-b border-border bg-card"
      style={{ height: `${chartHeight}px` }}
    >
      <span className="absolute left-3 top-3 z-10 border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600">
        CAPACIDAD DE PRODDUCION [{unitLabel}]
      </span>
      <nav className="absolute right-3 top-3 z-10 inline-flex items-center gap-px border border-border bg-background text-[10px] font-bold">
        {(["daily", "weekly", "monthly", "yearly"] as const).map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => onRateViewChange(view)}
            className={cn(
              "px-3 py-1 uppercase tracking-wide transition-colors",
              rateView === view
                ? "bg-amber-500 text-amber-950"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {view === "daily" && "D"}
            {view === "weekly" && "W"}
            {view === "monthly" && "M"}
            {view === "yearly" && "Y"}
          </button>
        ))}
      </nav>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`0 0 ${safeChartWidth} ${chartHeight}`}
        preserveAspectRatio="none"
        className="absolute inset-0 touch-none"
      >
        {[0.25, 0.5, 0.75].map((ratio) => {
          const y = chartPaddingY + plotHeight * ratio;
          const labelValue = Math.round(minRate + (1 - ratio) * rateSpan);
          return (
            <g key={ratio}>
              <line
                x1={0}
                y1={y}
                x2={safeChartWidth}
                y2={y}
                stroke="var(--gantt-line)"
                strokeDasharray="4 4"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={8}
                y={y}
                textAnchor="start"
                dominantBaseline="middle"
                className="text-[10px] font-semibold"
                fill="var(--muted-foreground)"
                pointerEvents="none"
              >
                {labelValue}
              </text>
            </g>
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
          const size = draggingKey === point.key ? 14 : point.isActive ? 12 : 8;
          const fill = point.isActive ? "var(--card)" : "transparent";
          const strokeOpacity = point.isActive ? 1 : 0.6;
          const showPreview =
            hoveredKey === point.key || draggingKey === point.key;
          const previewValue = Math.round(point.rate);

          return (
            <g key={point.key}>
              {showPreview && (
                <text
                  x={point.x}
                  y={Math.max(point.y - 10, chartPaddingY + 10)}
                  textAnchor="middle"
                  className="text-[10px] font-bold"
                  fill="var(--chart-1)"
                  stroke="var(--card)"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {previewValue}
                </text>
              )}
              <rect
                x={point.x - size / 2}
                y={point.y - size / 2}
                width={size}
                height={size}
                rx={2}
                fill={fill}
                stroke="var(--chart-1)"
                strokeWidth={2}
                strokeOpacity={strokeOpacity}
                className="cursor-ns-resize transition-colors"
                onPointerEnter={() => setHoveredKey(point.key)}
                onPointerLeave={() => {
                  if (!draggingKey) {
                    setHoveredKey(null);
                  }
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  setDraggingKey(point.key);
                  setHoveredKey(point.key);
                  applyRateChange(point.key, event.clientY);
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!point.isActive) return;
                  const updated = series.map((entry) =>
                    monthKey(entry.month) === point.key
                      ? { ...entry, isActive: false }
                      : entry
                  );
                  onPointsChange(updated);
                  onPointsSave?.(updated);
                }}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
};
