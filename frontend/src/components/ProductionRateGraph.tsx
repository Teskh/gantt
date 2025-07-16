import React, { useState, useRef, useCallback } from 'react';
import type { ProductionRatePoint } from '../App';

interface ProductionRateGraphProps {
    points: ProductionRatePoint[];
    onPointsChange: (points: ProductionRatePoint[]) => void;
    onPointsSave?: (points: ProductionRatePoint[]) => void;
    minDate: Date;
    maxDate: Date;
    minRate: number;
    maxRate: number;
}

const GRAPH_HEIGHT = 200;
const PADDING = 40;

export const ProductionRateGraph: React.FC<ProductionRateGraphProps> = ({
    points,
    onPointsChange,
    onPointsSave,
    minDate,
    maxDate,
    minRate,
    maxRate,
}) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const [draggingPointIndex, setDraggingPointIndex] = useState<number | null>(null);

    const dateToX = useCallback((date: Date, width: number) => {
        const minTime = minDate.getTime();
        const maxTime = maxDate.getTime();
        if (maxTime === minTime) return PADDING;
        const ratio = (date.getTime() - minTime) / (maxTime - minTime);
        return PADDING + ratio * (width - 2 * PADDING);
    }, [minDate, maxDate]);

    const yToRate = useCallback((y: number) => {
        if (maxRate === minRate) return minRate; // Avoid division by zero
        const rate = minRate + ((GRAPH_HEIGHT - PADDING - y) / (GRAPH_HEIGHT - 2 * PADDING)) * (maxRate - minRate);
        return Math.max(minRate, Math.min(maxRate, rate));
    }, [minRate, maxRate]);

    const rateToY = useCallback((rate: number) => {
        if (maxRate === minRate) return GRAPH_HEIGHT - PADDING; // Avoid division by zero
        const ratio = (rate - minRate) / (maxRate - minRate);
        return GRAPH_HEIGHT - PADDING - ratio * (GRAPH_HEIGHT - 2 * PADDING);
    }, [minRate, maxRate]);

    const xToDate = useCallback((x: number, width: number) => {
        const minTime = minDate.getTime();
        const maxTime = maxDate.getTime();
        const ratio = (x - PADDING) / (width - 2 * PADDING);
        const newTime = minTime + ratio * (maxTime - minTime);
        return new Date(newTime);
    }, [minDate, maxDate]);

    const handleMouseDown = (_e: React.MouseEvent, index: number) => {
        setDraggingPointIndex(index);
    };

    const handleMouseUp = useCallback(() => {
        if (draggingPointIndex !== null) {
            onPointsSave?.(points);
        }
        setDraggingPointIndex(null);
    }, [draggingPointIndex, points, onPointsSave]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (draggingPointIndex === null || !svgRef.current) return;

        const svgRect = svgRef.current.getBoundingClientRect();
        const y = e.clientY - svgRect.top;
        const newRate = yToRate(y);

        const newPoints = points.map((p, i) => 
            i === draggingPointIndex ? { ...p, rate: newRate } : p
        );
        onPointsChange(newPoints);
    }, [draggingPointIndex, points, onPointsChange, yToRate, minRate, maxRate]);

    const handlePointClick = (e: React.MouseEvent, index: number) => {
        if (e.ctrlKey) {
            e.preventDefault();
            const sortedPoints = [...points].sort((a, b) => a.date.getTime() - b.date.getTime());
            if (index > 0 && index < sortedPoints.length - 1) {
                const pointToDelete = sortedPoints[index];
                const newPoints = points.filter(p => p !== pointToDelete);
                onPointsChange(newPoints);
                onPointsSave?.(newPoints);
            }
        }
    };

    const handleClick = useCallback((e: React.MouseEvent) => {
        if (!e.shiftKey || !svgRef.current) return;

        const svgRect = svgRef.current.getBoundingClientRect();
        const x = e.clientX - svgRect.left;
        const y = e.clientY - svgRect.top;
        
        const width = svgRect.width;

        const newDate = xToDate(x, width);
        const newRate = yToRate(y);

        const newPoints = [...points, { date: newDate, rate: newRate }]
            .sort((a, b) => a.date.getTime() - b.date.getTime());
        
        onPointsChange(newPoints);
        onPointsSave?.(newPoints);
    }, [points, onPointsChange, onPointsSave, xToDate, yToRate]);

    const width = svgRef.current?.clientWidth ?? 800;
    const sortedPoints = [...points].sort((a, b) => a.date.getTime() - b.date.getTime());

    const pathData = sortedPoints
        .map(p => `${dateToX(p.date, width)},${rateToY(p.rate)}`)
        .join(' L ');

    return (
        <div className="relative" style={{ height: GRAPH_HEIGHT }}>
            <svg
                ref={svgRef}
                width="100%"
                height={GRAPH_HEIGHT}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onClick={handleClick}
                className="bg-muted rounded"
            >
                {/* Y-axis labels */}
                <text x="5" y={rateToY(maxRate) + 5} fontSize="12" fill="gray" className="non-selectable">{maxRate.toFixed(0)}</text>
                <line x1={PADDING} y1={rateToY(maxRate)} x2={width - PADDING} y2={rateToY(maxRate)} stroke="var(--muted-foreground)" />
                <text x="5" y={rateToY(minRate) + 5} fontSize="12" fill="gray" className="non-selectable">{minRate.toFixed(0)}</text>
                <line x1={PADDING} y1={rateToY(minRate)} x2={width - PADDING} y2={rateToY(minRate)} stroke="var(--muted-foreground)" />

                {/* X-axis labels */}
                <text x={PADDING} y={GRAPH_HEIGHT - 15} fontSize="12" fill="gray" textAnchor="middle" className="non-selectable">{minDate.toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}</text>
                <text x={width - PADDING} y={GRAPH_HEIGHT - 15} fontSize="12" fill="gray" textAnchor="middle" className="non-selectable">{maxDate.toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}</text>

                {/* Graph Path */}
                {pathData && <path d={`M ${pathData}`} stroke="#3b82f6" strokeWidth="2" fill="none" />}

                {/* Points */}
                {sortedPoints.map((p, i) => (
                    <circle
                        key={i}
                        cx={dateToX(p.date, width)}
                        cy={rateToY(p.rate)}
                        r="6"
                        fill="#3b82f6"
                        onMouseDown={(e) => handleMouseDown(e, points.indexOf(p))}
                        onClick={(e) => handlePointClick(e, i)}
                        className="cursor-ns-resize"
                    />
                ))}
                {/* Data Labels */}
                {sortedPoints.map((p, i) => (
                    <text
                        key={`label-${i}`}
                        x={dateToX(p.date, width)}
                        y={rateToY(p.rate) - 10} // Position above the circle
                        fontSize="12"
                        fill="#3b82f6"
                        textAnchor="middle"
                        className="non-selectable"
                    >
                        {p.rate.toFixed(0)}
                    </text>
                ))}
            </svg>
            <div className="absolute bottom-0 right-0 text-xs text-gray-500 p-1 non-selectable" style={{ marginBottom: '-20px' }}>
                Shift+clic para añadir. Ctrl+clic para eliminar. Arrastra para cambiar la tasa.
                Semana: 4.8 días, Mes: 20.5 días, Año: 250 días.
            </div>
        </div>
    );
};
