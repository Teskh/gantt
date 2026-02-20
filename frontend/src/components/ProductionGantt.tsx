import React, { useMemo, useEffect, useRef, useState, useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import { cn } from '@/lib/utils';
import type { Project, ProductionRatePoint } from '../App';
import { ProductionRateMonthly } from './ProductionRateMonthly';
import {
  getActivePoints,
  interpolateRate,
  monthKey,
  normalizeMonth,
} from '@/lib/production-rate';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { Pencil, PlusCircle, Trash2, Volume2, VolumeX, ArrowUp, ArrowDown, ArrowUpToLine, ArrowDownToLine, ArrowUpDown } from 'lucide-react';

interface ProductionGanttProps {
  projects: Project[];
  productionRatePoints: ProductionRatePoint[];
  onProjectUpdate: (projectId: number, newStart: Date) => void;
  onProductionRatePointsChange: (points: ProductionRatePoint[]) => void;
  onProductionRatePointsSave?: (points: ProductionRatePoint[]) => void;
  onProjectEdit: (project: Project) => void;
  onProjectDelete: (id: number) => void;
  onCreateProjectAtDate: (startDate: Date) => void;
  onProjectMuteToggle: (projectId: number) => void;
  onProjectReorder: (projectId: number, action: 'move-up' | 'move-down' | 'move-to-top' | 'move-to-bottom') => void;
  rangeStart: Date;
  rangeEnd: Date;
}

const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

const getRateForDate = (
  date: Date,
  activePoints: ProductionRatePoint[]
): number => interpolateRate(date, activePoints);

export const ProductionGantt: React.FC<ProductionGanttProps> = ({ 
  projects, 
  productionRatePoints, 
  onProjectUpdate, 
  onProductionRatePointsChange, 
  onProductionRatePointsSave,
  onProjectEdit,
  onProjectDelete,
  onCreateProjectAtDate,
  onProjectMuteToggle,
  onProjectReorder,
  rangeStart,
  rangeEnd,
}) => {
  const [contextMenuProject, setContextMenuProject] = useState<Project | null>(null);
  const [contextMenuDate, setContextMenuDate] = useState<Date | null>(null);
  const ganttChartRef = useRef<HTMLDivElement>(null);
  const [ganttChartWidth, setGanttChartWidth] = useState(100); // Set reasonable initial width
  const [dragInfo, setDragInfo] = useState<{ projectId: number; dragOffset: number } | null>(null);
  const [dragFeedback, setDragFeedback] = useState<{ left: number; date: string } | null>(null);
  const [textMeasurements, setTextMeasurements] = useState<{ [projectId: number]: { width: number; fits: boolean } }>({});

  /* ---------- Production-rate view (daily / weekly / monthly / yearly) ---------- */
  const [rateView, setRateView] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('daily');

  const rateMultipliers: Record<typeof rateView, number> = {
    daily: 1,
    weekly: 4.8,   // average working days per week
    monthly: 20.5, // average working days per month
    yearly: 250    // average working days per year
  };

  const minRateMap: Record<typeof rateView, number> = {
    daily: 80,
    weekly: 400,
    monthly: 1650,
    yearly: 20000,
  };

  const maxRateMap: Record<typeof rateView, number> = {
    daily: 140,
    weekly: 670,
    monthly: 2900,
    yearly: 35000,
  };

  const displayedPoints = useMemo(
    () =>
      productionRatePoints.map((p) => ({
        ...p,
        // scale for selected view
        rate: p.rate * rateMultipliers[rateView],
      })),
    [productionRatePoints, rateView]
  );

  const toDailyPoints = (points: ProductionRatePoint[]) =>
    points.map((p) => ({
      ...p,
      rate: p.rate / rateMultipliers[rateView],
    }));

  const activeRatePoints = useMemo(
    () => getActivePoints(productionRatePoints),
    [productionRatePoints]
  );

  const handleDisplayedPointsChange = (points: ProductionRatePoint[]) => {
    onProductionRatePointsChange(toDailyPoints(points));
  };

  const handleDisplayedPointsSave = (points: ProductionRatePoint[]) => {
    onProductionRatePointsSave?.(toDailyPoints(points));
  };

  const handleProjectAction = (action: 'add' | 'edit' | 'delete') => {
    if (action === 'add') {
      const date = contextMenuDate ?? contextMenuProject?.start ?? new Date();
      onCreateProjectAtDate(date);
    } else if (action === 'edit' && contextMenuProject) {
      onProjectEdit(contextMenuProject);
    } else if (action === 'delete' && contextMenuProject) {
      if (window.confirm(`¿Estás seguro de que quieres eliminar "${contextMenuProject.name}"?`)) {
        onProjectDelete(contextMenuProject.id);
      }
    }
    setContextMenuProject(null);
    setContextMenuDate(null);
  };

  const handleMuteToggle = () => {
    if (contextMenuProject) {
      onProjectMuteToggle(contextMenuProject.id);
    }
    setContextMenuProject(null);
    setContextMenuDate(null);
  };

  const handleReorder = (action: 'move-up' | 'move-down' | 'move-to-top' | 'move-to-bottom') => {
    if (contextMenuProject) {
      onProjectReorder(contextMenuProject.id, action);
    }
    setContextMenuProject(null);
    setContextMenuDate(null);
  };

  const handleContainerContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const projectElement = target.closest('[data-project-id]');
    if (projectElement) {
      const projectId = parseInt(projectElement.getAttribute('data-project-id')!, 10);
      const project = calculatedProjects.find(p => p.id === projectId);
      if (project) {
        flushSync(() => {
          setContextMenuProject(project);
          setContextMenuDate(null);
        });
        return;
      }
    }

    // Empty space
    const rect = ganttChartRef.current?.getBoundingClientRect();
    if (rect && dayWidth > 0) {
      const x = e.clientX - rect.left;
      const dayOffset = Math.floor(x / dayWidth);
      const clickedDate = addDays(minDate, dayOffset);
      flushSync(() => {
        setContextMenuDate(clickedDate);
        setContextMenuProject(null);
      });
    }
  };

  useEffect(() => {
    const element = ganttChartRef.current;
    if (!element) return;

    // Set initial width immediately
    setGanttChartWidth(element.offsetWidth || 100);

    const resizeObserver = new ResizeObserver(() => {
      setGanttChartWidth(element.offsetWidth);
    });

    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);

  const calculatedProjects = useMemo(() => {
    if (projects.length === 0 || activeRatePoints.length === 0) return [];

    const processingProjects = projects.map(p => ({
      ...p,
      start: new Date(p.start), // Ensure start is a Date object
      // adjust required area by complexity (GG) relative to default 4.5
      remainingM2: p.m2 * (p.gg ?? 4.5) / 4.5,
      end: undefined as Date | undefined,
      muted: p.muted ?? false,
    }));

    // Sort by start date to have a predictable starting point
    processingProjects.sort((a, b) => a.start.getTime() - b.start.getTime());

    let currentDate = new Date(processingProjects[0].start);
    currentDate.setHours(0, 0, 0, 0);

    let safetyBreak = 10000; // Limit iterations to prevent infinite loops, 10000 days is ~27 years

    while (processingProjects.some(p => p.remainingM2 > 0 && !p.muted)) {
      if (safetyBreak-- <= 0) {
        console.error("Gantt calculation exceeded maximum iterations.");
        break;
      }

      const activeProjects = processingProjects.filter(p => !p.muted && p.start.getTime() <= currentDate.getTime() && p.remainingM2 > 0);

      if (activeProjects.length > 0) {
        const rateForDay = getRateForDate(currentDate, activeRatePoints) * (250 / 365);
        if (rateForDay <= 0) {
            currentDate = addDays(currentDate, 1);
            continue;
        }

        const totalPriority = activeProjects.reduce((sum, p) => sum + (p.priority ?? 10), 0);
        if (totalPriority <= 0) {
            currentDate = addDays(currentDate, 1);
            continue;
        }

        for (const project of activeProjects) {
          const allocation = rateForDay * ((project.priority ?? 10) / totalPriority);
          project.remainingM2 -= allocation;

          if (project.remainingM2 <= 0 && !project.end) {
            project.end = new Date(currentDate);
          }                                                                                                                                                                                                         
        }                                                                                                                                                                                                           
      }                                                                                                                                                                                                             
                                                                                                                                                                                                                    
      currentDate = addDays(currentDate, 1);
    }

    processingProjects.forEach(p => {
      if (p.muted && p.end === undefined) {
        p.end = new Date(p.start);
      }
    });

    return processingProjects
      .filter(
        (p): p is typeof p & { end: Date } => p.end !== undefined
      )
      .map(p => {
        const duration = (p.end.getTime() - p.start.getTime()) / (1000 * 3600 * 24) + 1;
        return { ...p, duration: Math.max(1, Math.round(duration)) }; // Ensure duration is at least 1 day
      })
      .sort((a, b) => a.displayOrder - b.displayOrder); // Sort by display order
  }, [projects, activeRatePoints]);

  const [minDate, maxDate] = useMemo(() => {
    const start = normalizeMonth(rangeStart);
    const end = normalizeMonth(rangeEnd);
    const lastDay = new Date(end.getFullYear(), end.getMonth() + 1, 0);
    start.setHours(0, 0, 0, 0);
    lastDay.setHours(0, 0, 0, 0);
    return [start, lastDay];
  }, [rangeStart, rangeEnd]);

  const minMonth = useMemo(() => normalizeMonth(minDate), [minDate]);
  const maxMonth = useMemo(() => normalizeMonth(maxDate), [maxDate]);

  const totalDays = Math.max(1, Math.round((maxDate.getTime() - minDate.getTime()) / (1000 * 3600 * 24)) + 1);
  
  if (totalDays > 3650) { // Limit display to 10 years
    return <div className="p-4 text-center text-red-500">El rango de fechas calculado es demasiado grande para mostrar.</div>;
  }

  const projectColumnWidth = 0;
  const timelineWidth = ganttChartWidth > 0 ? ganttChartWidth - projectColumnWidth : 0;
  const dayWidth = (totalDays > 0 && timelineWidth > 0) ? timelineWidth / totalDays : 0;

  const monthHeaders = useMemo(() => {
    if (!minDate || !maxDate || totalDays <= 0) return [];

    const months = [];
    let currentDate = new Date(minDate.getFullYear(), minDate.getMonth(), 1);

    while (currentDate <= maxDate) {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();
      const firstDayOfMonth = new Date(year, month, 1);
      const lastDayOfMonth = new Date(year, month + 1, 0);

      const start = (firstDayOfMonth < minDate) ? minDate : firstDayOfMonth;
      const end = (lastDayOfMonth > maxDate) ? maxDate : lastDayOfMonth;

      const daysInView = Math.round((end.getTime() - start.getTime()) / (1000 * 3600 * 24)) + 1;

      if (daysInView > 0) {
        months.push({
          date: new Date(currentDate),
          width: daysInView * dayWidth,
        });
      }

      currentDate.setMonth(currentDate.getMonth() + 1);
    }
    return months;
  }, [minDate, maxDate, totalDays, dayWidth]);

  const monthPositions = useMemo(() => {
    let cursor = 0;
    return monthHeaders.map((header) => {
      const width = header.width;
      const x = cursor + width / 2;
      cursor += width;
      return {
        key: monthKey(header.date),
        date: header.date,
        width,
        x,
      };
    });
  }, [monthHeaders]);

  const monthAbbr = [
    "ENE",
    "FEB",
    "MAR",
    "ABR",
    "MAY",
    "JUN",
    "JUL",
    "AGO",
    "SEP",
    "OCT",
    "NOV",
    "DIC",
  ];

  const monthBoundaries = useMemo(() => {
    let cursor = 0;
    const boundaries = [0];
    monthHeaders.forEach((header) => {
      cursor += header.width;
      boundaries.push(cursor);
    });
    return boundaries;
  }, [monthHeaders]);

  // --- Project summary for header hover ---------------------------------------------------------
  const projectSummary = useMemo(() => {
    // Ignore muted projects when calculating the summary
    const activeProjects = calculatedProjects.filter((p) => !p.muted);
    if (activeProjects.length === 0) return null;

    const totalProjects = activeProjects.length;
    const aggregateM2 = activeProjects.reduce((sum, p) => sum + p.m2, 0);
    const averageGG =
      activeProjects.reduce((sum, p) => sum + (p.gg ?? 4.5), 0) / totalProjects;
    const earliestStart = new Date(
      Math.min(...activeProjects.map((p) => p.start.getTime()))
    );
    const latestEnd = new Date(
      Math.max(...activeProjects.map((p) => p.end.getTime()))
    );

    return { totalProjects, aggregateM2, averageGG, earliestStart, latestEnd };
  }, [calculatedProjects]);


  const rowHeight = 40; // pixels
  const textMeasureRef = useRef<HTMLSpanElement>(null);

  // Measure text widths for all projects
  useLayoutEffect(() => {
    if (!textMeasureRef.current) return;
    
    const measurements: { [projectId: number]: { width: number; fits: boolean } } = {};
    
    calculatedProjects.forEach(project => {
      const width = Math.max(0, project.duration * dayWidth - 2);
      
      // Measure text width
      textMeasureRef.current!.textContent = project.name;
      const textWidth = textMeasureRef.current!.offsetWidth;
      
      measurements[project.id] = {
        width: textWidth,
        fits: textWidth <= width - 16 // Account for padding
      };
    });
    
    setTextMeasurements(measurements);
  }, [calculatedProjects, dayWidth, minDate]);

  const handleDragStart = (e: React.DragEvent, projectId: number) => {
    const barElement = e.currentTarget as HTMLDivElement;
    const offset = e.clientX - barElement.getBoundingClientRect().left;
    e.dataTransfer.setData("application/json", JSON.stringify({ projectId, dragOffset: offset }));
    e.dataTransfer.effectAllowed = 'move';
    setDragInfo({ projectId, dragOffset: offset });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragInfo) return;

    const dropContainer = e.currentTarget as HTMLDivElement;
    const containerLeft = dropContainer.getBoundingClientRect().left;
    const dropX = e.clientX - containerLeft;
    const newBarLeft = dropX - dragInfo.dragOffset;

    if (dayWidth <= 0) return;

    const newDayOffset = Math.max(0, Math.round(newBarLeft / dayWidth));
    const newStartDate = addDays(minDate, newDayOffset);

    setDragFeedback({
      left: newDayOffset * dayWidth,
      date: newStartDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const data = e.dataTransfer.getData("application/json");
    if (!data) return;

    const { projectId, dragOffset } = JSON.parse(data);

    if (!projectId) return;

    const dropContainer = e.currentTarget as HTMLDivElement;
    const containerLeft = dropContainer.getBoundingClientRect().left;
    const dropX = e.clientX - containerLeft;
    const newBarLeft = dropX - dragOffset;

    if (dayWidth <= 0) return;
    
    const newDayOffset = Math.max(0, Math.round(newBarLeft / dayWidth));
    const newStartDate = addDays(minDate, newDayOffset);

    onProjectUpdate(projectId, newStartDate);
    setDragFeedback(null);
  };

  return (
    <div className="flex min-h-full flex-col">
      <ProductionRateMonthly
        points={displayedPoints}
        onPointsChange={handleDisplayedPointsChange}
        onPointsSave={handleDisplayedPointsSave}
        minMonth={minMonth}
        maxMonth={maxMonth}
        minRate={minRateMap[rateView]}
        maxRate={maxRateMap[rateView]}
        rateView={rateView}
        onRateViewChange={setRateView}
        monthPositions={monthPositions}
      />

      <HoverCard>
        <HoverCardTrigger asChild>
          <div
            className="gantt-header grid w-full min-w-full bg-muted border-b border-border text-[10px] font-bold uppercase tracking-wide text-muted-foreground overflow-hidden"
            style={{
              gridTemplateColumns: `${monthHeaders
                .map((m) => `${m.width}px`)
                .join(' ')}`,
            }}
          >
            {monthHeaders.map(({ date }, index) => {
              const showYear = date.getMonth() === 0 || index === 0;
              return (
                <div
                  key={date.toISOString()}
                  className="flex items-center justify-center border-r border-border/60 py-2 px-1 text-center"
                >
                  {monthAbbr[date.getMonth()]}
                  {showYear && ` ${date.getFullYear()}`}
                </div>
              );
            })}
          </div>
        </HoverCardTrigger>
        <HoverCardContent className="w-[800px] max-h-none overflow-visible bg-popover text-popover-foreground z-40 rounded-none" side="top" align="center" sideOffset={10}>
          <div className="space-y-3">
            <h3 className="font-semibold text-sm">Resumen de Proyectos</h3>
            <div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left border-b">
                    <th className="px-2 py-1 min-w-[120px]">Proyecto</th>
                    <th className="px-2 py-1 text-right min-w-[60px]">m²</th>
                    <th className="px-2 py-1 text-right min-w-[80px]">m²&nbsp;equivalente</th>
                    <th className="px-2 py-1 text-right min-w-[40px]">GG</th>
                    <th className="px-2 py-1 min-w-[80px]">Inicio</th>
                    <th className="px-2 py-1 min-w-[80px]">Fin</th>
                  </tr>
                </thead>
                <tbody>
                  {calculatedProjects.map((p) => (
                    <tr key={p.id} className="border-b border-border/50">
                      <td className="px-2 py-1 truncate max-w-[120px]" title={p.name}>
                        {p.name}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {p.m2.toLocaleString()}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {Math.round((p.m2 * (p.gg ?? 4.5)) / 4.5).toLocaleString()}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {(p.gg ?? 4.5).toFixed(1)}
                      </td>
                      <td className="px-2 py-1">
                        {p.start.toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: '2-digit',
                        })}
                      </td>
                      <td className="px-2 py-1">
                        {p.end.toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: '2-digit',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {projectSummary && (
              <div className="grid grid-cols-2 gap-4 pt-2 border-t text-xs">
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total proyectos:</span>
                    <span className="font-semibold">{projectSummary.totalProjects}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total m²:</span>
                    <span className="font-semibold">
                      {projectSummary.aggregateM2.toLocaleString()}
                    </span>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">GG promedio:</span>
                    <span className="font-semibold">
                      {projectSummary.averageGG.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Período:</span>
                    <span className="font-semibold text-right">
                      {projectSummary.earliestStart.toLocaleDateString(undefined, {
                        month: 'short',
                        year: '2-digit',
                      })}{' '}
                      –{' '}
                      {projectSummary.latestEnd.toLocaleDateString(undefined, {
                        month: 'short',
                        year: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </HoverCardContent>
      </HoverCard>

      <ContextMenu onOpenChange={(open) => {
        if (!open) {
          setContextMenuProject(null);
          setContextMenuDate(null);
        }
      }}>
        <ContextMenuTrigger asChild>
          <div
            ref={ganttChartRef}
            className="gantt-body relative w-full min-w-full flex-1 bg-background overflow-hidden"
            style={{ minHeight: `${Math.max(calculatedProjects.length * rowHeight, 200)}px` }}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onContextMenu={handleContainerContextMenu}
          >
            <div className="absolute inset-0 pointer-events-none">
              {monthBoundaries.slice(0, -1).map((position, index) => (
                <div
                  key={`${position}-${index}`}
                  className="absolute top-0 bottom-0 w-px"
                  style={{
                    left: `${position}px`,
                    backgroundColor: "var(--gantt-line-subtle)",
                  }}
                />
              ))}
            </div>
                {/* Hidden span for measuring text width */}
                <span 
                  ref={textMeasureRef}
                  className="absolute opacity-0 pointer-events-none text-xs font-bold whitespace-nowrap"
                  style={{ top: '-1000px' }}
                />
                
                {calculatedProjects.map((project, index) => {
                  const offsetDays = (project.start.getTime() - minDate.getTime()) / (1000 * 3600 * 24);
                  const left = offsetDays * dayWidth;
                  const width = Math.max(0, project.duration * dayWidth - 2); // -2 for some horizontal padding
                  const measurement = textMeasurements[project.id];
                  const textFits = measurement?.fits ?? true;

                  return (
                    <div key={project.id} className="gantt-row grid absolute w-full" style={{ gridTemplateColumns: `1fr`, top: `${index * rowHeight}px`, height: `${rowHeight}px` }}>
                      <div
                        className="gantt-bars-container relative h-full"
                      >
                        {dragFeedback && dragInfo?.projectId === project.id && (
                          <div className="absolute top-0 bottom-0 z-50 pointer-events-none" style={{ left: `${dragFeedback.left}px` }}>
                            <div className="h-full w-px bg-primary/75"></div>
                            <div className="absolute -top-2 left-0 -translate-x-1/2 -translate-y-full bg-popover text-popover-foreground text-xs font-mono px-2.5 py-1.5 rounded-md border border-primary/20 shadow-md whitespace-nowrap">
                              {dragFeedback.date}
                            </div>
                          </div>
                        )}
                         <HoverCard>
                           <HoverCardTrigger asChild>
                             {/* This div acts as the hover trigger area and positions the draggable bar */}
                             <div
                               className={cn(
                                 'absolute h-3/5 top-1/2 -translate-y-1/2 text-xs select-none',
                                 { 'opacity-50': project.muted }
                               )}
                               style={{ left: `${left}px`, width: `${width}px` }}
                             >
                               {/* This inner div is the actual draggable element */}
                               <div
                                 draggable
                                 onDoubleClick={() => onProjectMuteToggle(project.id)}
                                 onDragStart={(e) => handleDragStart(e, project.id)}
                                 onDragEnd={() => { setDragInfo(null); setDragFeedback(null); }}
                                 className={cn(
                                   "h-full w-full cursor-move border px-2 flex items-center justify-center text-xs font-bold uppercase tracking-tight transition-colors transition-shadow rounded-none",
                                   project.muted
                                     ? "project-bar-muted border-dashed"
                                     : "project-bar"
                                 )}
                                 data-project-id={project.id}
                               >
                                 {textFits ? (
                                   <span className="truncate px-2 flex items-center justify-center h-full">
                                     {project.name}
                                   </span>
                                 ) : (
                                   <div className="relative h-full w-full">
                                     <span
                                       className="absolute font-bold text-foreground bg-card px-2 py-1 rounded-none shadow-sm border whitespace-nowrap z-10"
                                       style={{
                                         left: '100%',
                                         top: '50%',
                                         transform: 'translate(15px, -50%)',
                                       }}
                                     >
                                       {project.name}
                                     </span>
                                   </div>
                                 )}
                               </div>
                             </div>
                           </HoverCardTrigger>
                           <HoverCardContent className="w-64 bg-popover text-popover-foreground rounded-none">
                             <div className="space-y-2 p-2 text-xs">
                               <p className="font-bold text-sm">{project.name}</p>
                               <div className="grid grid-cols-[50px,1fr] gap-y-1 items-center">
                                 <span className="text-muted-foreground">Área total / equivalente</span>
                                 <span className="font-semibold">{`${project.m2.toLocaleString()} / ${Math.round((project.m2 * (project.gg ?? 4.5)) / 4.5).toLocaleString()} m²`}</span>
                                 <span className="text-muted-foreground">GG</span>
                                 <span className="font-semibold">{project.gg}</span>
                                 <span className="text-muted-foreground">Prioridad</span>
                                 <span className="font-semibold">{project.priority ?? 10}</span>
                                 <span className="text-muted-foreground">Inicio</span>
                                 <span className="font-semibold">{project.start.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                                 <span className="text-muted-foreground">Fin</span>
                                 <span className="font-semibold">{project.end.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                               </div>
                               <div className="pt-1">
                                 <p className="font-semibold">Duración</p>
                                 <div className="flex justify-between text-muted-foreground pt-1">
                                   <span>{project.duration} días</span>
                                   <span>{(project.duration / 7).toFixed(1)} sem.</span>
                                   <span>{(project.duration / (365/12)).toFixed(1)} meses</span>
                                 </div>
                               </div>
                             </div>
                           </HoverCardContent>
                         </HoverCard>
                      </div>
                    </div>
                  );
                })}

                {calculatedProjects.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                    No hay proyectos para mostrar. Haz clic derecho para añadir un proyecto.
                  </div>
                )}
              </div>
            </ContextMenuTrigger>
          <ContextMenuContent className="w-48">
            <>
              <ContextMenuItem onClick={() => handleProjectAction('add')}>
                <PlusCircle />
                Añadir proyecto
              </ContextMenuItem>
              {contextMenuProject && (
                <>
                  <ContextMenuItem onClick={() => handleProjectAction('edit')}>
                    <Pencil />
                    Editar proyecto
                  </ContextMenuItem>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <ArrowUpDown className="w-4 h-4 mr-2" />
                      Cambiar orden
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className="w-48">
                      <ContextMenuItem onClick={() => handleReorder('move-to-top')}>
                        <ArrowUpToLine className="mr-2" />
                        Mover al inicio
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => handleReorder('move-up')}>
                        <ArrowUp className="mr-2" />
                        Mover hacia arriba
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => handleReorder('move-down')}>
                        <ArrowDown className="mr-2" />
                        Mover hacia abajo
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => handleReorder('move-to-bottom')}>
                        <ArrowDownToLine className="mr-2" />
                        Mover al fondo
                      </ContextMenuItem>
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={handleMuteToggle}>
                    {contextMenuProject.muted ? (
                      <>
                        <Volume2 />
                        Reactivar proyecto
                      </>
                    ) : (
                      <>
                        <VolumeX />
                        Silenciar proyecto
                      </>
                    )}
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => handleProjectAction('delete')}
                    variant="destructive"
                  >
                    <Trash2 />
                    Eliminar proyecto
                  </ContextMenuItem>
                </>
              )}
            </>
          </ContextMenuContent>
        </ContextMenu>
    </div>
  );
};
