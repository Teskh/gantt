import React, { useMemo, useEffect, useRef, useState, useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import { cn } from '@/lib/utils';
import type { Project, ProductionRatePoint } from '../App';
import { ProductionRateMonthly } from './ProductionRateMonthly';
import {
  calculateProductionM2,
  getActivePoints,
  getDailyProductionRate,
  mergeMonthlySeries,
  monthKey,
  normalizeMonth,
} from '@/lib/production-rate';
import { compareProjectOrder, moveTargetIndex } from '@/lib/project-order';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { Pencil, PlusCircle, Trash2, Volume2, VolumeX, ArrowUp, ArrowDown, ArrowUpToLine, ArrowDownToLine, ArrowUpDown } from 'lucide-react';

interface ProductionGanttProps {
  projects: Project[];
  unreadBaseProjectIds: ReadonlySet<number>;
  productionRatePoints: ProductionRatePoint[];
  onProjectUpdate: (projectId: number, newStart: Date) => void;
  onProductionRatePointsChange: (points: ProductionRatePoint[]) => void;
  onProductionRatePointsSave?: (points: ProductionRatePoint[]) => void;
  onProjectOpen: (project: Project) => void;
  onProjectEdit: (project: Project) => void;
  onProjectDelete: (id: number) => void;
  onCreateProjectAtDate: (startDate: Date) => void;
  onProjectMuteToggle: (projectId: number) => void;
  onProjectReorder: (projectId: number, action: 'move-up' | 'move-down' | 'move-to-top' | 'move-to-bottom') => void;
  onProjectMoveTo: (projectId: number, targetIndex: number) => void;
  rangeStart: Date;
  rangeEnd: Date;
  isEditingEnabled: boolean;
  onInteractionChange?: (active: boolean) => void;
  // Phone layout: shows either the Gantt or the capacity chart, full screen.
  compact?: boolean;
  // Unfolded iPhone Duo: phone layout with full-size rows.
  roomyRows?: boolean;
  compactView?: 'gantt' | 'capacity';
  // Leaves muted projects out of the rows (the phone view offers this).
  hideMuted?: boolean;
}

const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

const getRoundedMonthAhead = (date: Date, monthsAhead: number): Date =>
  new Date(
    date.getFullYear(),
    date.getMonth() + monthsAhead + (date.getDate() > 1 ? 1 : 0),
    1
  );

const getReadableTextColor = (hexColor: string): string => {
  const normalized = hexColor.replace('#', '');
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.58 ? '#0f172a' : '#ffffff';
};

const getProjectBarStyle = (project: Project): React.CSSProperties => {
  if (!project.color || project.muted) return {};

  return {
    backgroundColor: project.color,
    borderColor: project.color,
    color: getReadableTextColor(project.color),
    boxShadow: `2px 2px 0 color-mix(in srgb, ${project.color} 28%, transparent)`,
  };
};

type RateView = 'daily' | 'weekly' | 'monthly' | 'yearly';

interface BarDrag {
  projectId: number;
  pointerId: number;
  // Plain drag shifts the start date; Ctrl/Cmd + drag moves the row up or down.
  mode: 'shift' | 'reorder';
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  active: boolean;
}

const DRAG_THRESHOLD_PX = 4;
const COMPACT_MONTH_WIDTH_PX = 64;
const DAY_MS = 1000 * 3600 * 24;
const ROW_HEIGHT = 28; // pixels
const COMPACT_ROW_HEIGHT = 20;

const reorderSlot = (originIndex: number, dy: number, rowCount: number) =>
  Math.min(rowCount - 1, Math.max(0, Math.round(originIndex + dy / ROW_HEIGHT)));

const RATE_MULTIPLIERS: Record<RateView, number> = {
  daily: 1,
  weekly: 4.8,
  monthly: 20.5,
  yearly: 250,
};

const MIN_RATE_MAP: Record<RateView, number> = {
  daily: 80,
  weekly: 400,
  monthly: 1650,
  yearly: 20000,
};

const MAX_RATE_MAP: Record<RateView, number> = {
  daily: 140,
  weekly: 670,
  monthly: 2900,
  yearly: 35000,
};

type RateRange = { min: number; max: number };
type RateRangeOverrides = Partial<Record<RateView, RateRange>>;

const RATE_RANGE_STORAGE_KEY = 'gantt-rate-ranges';

const loadRateRangeOverrides = (): RateRangeOverrides => {
  try {
    const raw = localStorage.getItem(RATE_RANGE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as RateRangeOverrides;
    const result: RateRangeOverrides = {};
    (['daily', 'weekly', 'monthly', 'yearly'] as const).forEach((view) => {
      const range = parsed?.[view];
      if (
        range &&
        Number.isFinite(range.min) &&
        Number.isFinite(range.max) &&
        range.max > range.min
      ) {
        result[view] = { min: range.min, max: range.max };
      }
    });
    return result;
  } catch {
    return {};
  }
};

export const ProductionGantt: React.FC<ProductionGanttProps> = ({ 
  projects, 
  unreadBaseProjectIds,
  productionRatePoints, 
  onProjectUpdate, 
  onProductionRatePointsChange, 
  onProductionRatePointsSave,
  onProjectOpen,
  onProjectEdit,
  onProjectDelete,
  onCreateProjectAtDate,
  onProjectMuteToggle,
  onProjectReorder,
  onProjectMoveTo,
  rangeStart,
  rangeEnd,
  isEditingEnabled,
  onInteractionChange,
  compact: isCompact = false,
  roomyRows = false,
  compactView = 'gantt',
  hideMuted = false,
}) => {
  const denseRows = isCompact && !roomyRows;
  const rowHeight = denseRows ? COMPACT_ROW_HEIGHT : ROW_HEIGHT;
  const showCapacity = !isCompact || compactView === 'capacity';
  const showGantt = !isCompact || compactView === 'gantt';
  const scrollerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const monthHeaderRef = useRef<HTMLDivElement>(null);
  const [compactChartHeight, setCompactChartHeight] = useState(0);
  const [contextMenuProject, setContextMenuProject] = useState<Project | null>(null);
  const [contextMenuDate, setContextMenuDate] = useState<Date | null>(null);
  const ganttChartRef = useRef<HTMLDivElement>(null);
  const [ganttChartWidth, setGanttChartWidth] = useState(0); // Measured right after mount
  const dragRef = useRef<BarDrag | null>(null);
  const [drag, setDrag] = useState<BarDrag | null>(null);
  const suppressProjectClickRef = useRef(false);
  const [textMeasurements, setTextMeasurements] = useState<{ [projectId: number]: { width: number; fits: boolean } }>({});

  /* ---------- Production-rate view (daily / weekly / monthly / yearly) ---------- */
  const [rateView, setRateView] = useState<RateView>('daily');
  const [rateRangeOverrides, setRateRangeOverrides] = useState<RateRangeOverrides>(
    () => loadRateRangeOverrides()
  );

  const rateRange = rateRangeOverrides[rateView] ?? {
    min: MIN_RATE_MAP[rateView],
    max: MAX_RATE_MAP[rateView],
  };

  const persistRateRangeOverrides = (next: RateRangeOverrides) => {
    setRateRangeOverrides(next);
    try {
      localStorage.setItem(RATE_RANGE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore storage failures (private mode, quota) */
    }
  };

  const handleRateRangeChange = (min: number, max: number) => {
    persistRateRangeOverrides({ ...rateRangeOverrides, [rateView]: { min, max } });
  };

  const handleRateRangeReset = () => {
    const next = { ...rateRangeOverrides };
    delete next[rateView];
    persistRateRangeOverrides(next);
  };

  const displayedPoints = useMemo(
    () =>
      productionRatePoints.map((p) => ({
        ...p,
        // scale for selected view
        rate: p.rate * RATE_MULTIPLIERS[rateView],
      })),
    [productionRatePoints, rateView]
  );

  // The chart only edits the visible months; merge them into the full list so the
  // save does not delete capacity points outside the visible range. Unedited months
  // keep their stored rate instead of a scaled-and-unscaled float.
  const toDailyPoints = (points: ProductionRatePoint[]) => {
    const multiplier = RATE_MULTIPLIERS[rateView];
    const storedByMonth = new Map(productionRatePoints.map((p) => [monthKey(p.month), p]));
    const edited = points.map((p) => {
      const stored = storedByMonth.get(monthKey(p.month));
      const rate = stored && stored.rate * multiplier === p.rate ? stored.rate : p.rate / multiplier;
      return { ...p, rate };
    });
    return mergeMonthlySeries(productionRatePoints, edited);
  };

  const activeRatePoints = useMemo(
    () => getActivePoints(productionRatePoints),
    [productionRatePoints]
  );

  const handleDisplayedPointsChange = (points: ProductionRatePoint[]) => {
    if (!isEditingEnabled) return;
    onProductionRatePointsChange(toDailyPoints(points));
  };

  const handleDisplayedPointsSave = (points: ProductionRatePoint[]) => {
    if (!isEditingEnabled) return;
    onProductionRatePointsSave?.(toDailyPoints(points));
  };

  const handleProjectAction = (action: 'add' | 'edit' | 'delete') => {
    if (!isEditingEnabled) {
      setContextMenuProject(null);
      setContextMenuDate(null);
      return;
    }
    if (action === 'add') {
      const date = contextMenuDate ?? contextMenuProject?.start ?? new Date();
      onCreateProjectAtDate(date);
    } else if (action === 'edit' && contextMenuProject) {
      onProjectEdit(contextMenuProject);
    } else if (action === 'delete' && contextMenuProject) {
      const confirmed = window.confirm(
        `¿Eliminar “${contextMenuProject.name}” de todos los escenarios?\n\n` +
        "También se eliminarán sus estados y notas. Para ocultarlo solamente en este escenario, usa “Silenciar proyecto”."
      );
      if (confirmed) onProjectDelete(contextMenuProject.id);
    }
    setContextMenuProject(null);
    setContextMenuDate(null);
  };

  const handleMuteToggle = () => {
    if (!isEditingEnabled) return;
    if (contextMenuProject) {
      onProjectMuteToggle(contextMenuProject.id);
    }
    setContextMenuProject(null);
    setContextMenuDate(null);
  };

  const handleReorder = (action: 'move-up' | 'move-down' | 'move-to-top' | 'move-to-bottom') => {
    if (!isEditingEnabled) return;
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
    const element = timelineRef.current;
    if (!element) return;

    // Set initial width immediately
    setGanttChartWidth(element.offsetWidth || 100);

    const resizeObserver = new ResizeObserver(() => {
      setGanttChartWidth(element.offsetWidth);
    });

    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);

  // The phone capacity view gives the chart all the height the month header leaves.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const header = monthHeaderRef.current;
    if (!isCompact || !showCapacity || !scroller || !header) return;
    const measure = () =>
      setCompactChartHeight(Math.max(140, scroller.clientHeight - header.offsetHeight));
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(scroller);
    resizeObserver.observe(header);
    return () => resizeObserver.disconnect();
  }, [isCompact, showCapacity]);

  // Folding or unfolding an iPhone Duo changes the row height; keep the same rows in view.
  const previousRowHeightRef = useRef(rowHeight);
  useLayoutEffect(() => {
    const previous = previousRowHeightRef.current;
    previousRowHeightRef.current = rowHeight;
    const scroller = scrollerRef.current;
    if (!scroller || previous === rowHeight) return;
    scroller.scrollTop = scroller.scrollTop * (rowHeight / previous);
  }, [rowHeight]);

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
        const rateForDay = getDailyProductionRate(currentDate, activeRatePoints);
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
      .sort(compareProjectOrder);
  }, [projects, activeRatePoints]);

  const rowProjects = useMemo(
    () => (hideMuted ? calculatedProjects.filter((project) => !project.muted) : calculatedProjects),
    [calculatedProjects, hideMuted]
  );

  const [minDate, maxDate] = useMemo(() => {
    const start = normalizeMonth(rangeStart);
    const end = normalizeMonth(rangeEnd);
    const lastDay = new Date(end.getFullYear(), end.getMonth() + 1, 0);
    start.setHours(0, 0, 0, 0);
    lastDay.setHours(0, 0, 0, 0);
    return [start, lastDay];
  }, [rangeStart, rangeEnd]);

  // Projects at the top of the order that finished before the visible range give
  // up their rows, so the first project in view sits on the first row.
  const hiddenLeadingRows = useMemo(() => {
    const firstInView = rowProjects.findIndex((project) => project.end >= minDate);
    return firstInView < 0 ? rowProjects.length : firstInView;
  }, [rowProjects, minDate]);

  const minMonth = useMemo(() => normalizeMonth(minDate), [minDate]);
  const maxMonth = useMemo(() => normalizeMonth(maxDate), [maxDate]);

  const visibleProjects = useMemo(
    () =>
      calculatedProjects.filter(
        (project) => project.start <= maxDate && project.end >= minDate
      ),
    [calculatedProjects, minDate, maxDate]
  );

  const totalDays = Math.max(1, Math.round((maxDate.getTime() - minDate.getTime()) / DAY_MS) + 1);
  const monthCount =
    (maxDate.getFullYear() - minDate.getFullYear()) * 12 + maxDate.getMonth() - minDate.getMonth() + 1;
  // On phones the Gantt fits the whole range on screen; the capacity chart keeps
  // readable months and scrolls sideways instead.
  const minTimelineWidth = isCompact && compactView === 'capacity'
    ? monthCount * COMPACT_MONTH_WIDTH_PX
    : undefined;
  const isRangeTooLarge = totalDays > 3650;

  const projectColumnWidth = 0;
  const timelineWidth = ganttChartWidth > 0 ? ganttChartWidth - projectColumnWidth : 0;
  const visibleTotalDays = isRangeTooLarge ? 1 : totalDays;
  const dayWidth = (visibleTotalDays > 0 && timelineWidth > 0) ? timelineWidth / visibleTotalDays : 0;

  const monthHeaders = useMemo(() => {
    if (!minDate || !maxDate || totalDays <= 0 || isRangeTooLarge) return [];

    const months = [];
    const currentDate = new Date(minDate.getFullYear(), minDate.getMonth(), 1);

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
  }, [minDate, maxDate, totalDays, dayWidth, isRangeTooLarge]);

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

  const timelineMilestones = useMemo(() => {
    if (dayWidth <= 0 || isRangeTooLarge) return [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayMs = 1000 * 3600 * 24;
    const futureMilestones = [6, 12, 18].map((monthsAhead) => ({
      key: `${monthsAhead}-months`,
      label: `${monthsAhead}M`,
      description: `${monthsAhead} meses`,
      date: getRoundedMonthAhead(today, monthsAhead),
      isNow: false,
    }));

    return [
      {
        key: 'now',
        label: 'AHORA',
        description: 'Ahora',
        date: today,
        isNow: true,
      },
      ...futureMilestones,
    ]
      .filter(({ date }) => date >= minDate && date <= maxDate)
      .map((milestone) => ({
        ...milestone,
        left: ((milestone.date.getTime() - minDate.getTime()) / dayMs) * dayWidth,
        formattedDate: milestone.date.toLocaleDateString('es-CL', {
          day: milestone.isNow ? 'numeric' : undefined,
          month: 'short',
          year: 'numeric',
        }),
      }));
  }, [dayWidth, isRangeTooLarge, minDate, maxDate]);

  const noProductionGaps = useMemo(() => {
    if (isRangeTooLarge || dayWidth <= 0 || calculatedProjects.length === 0) return [];

    const dayMs = 1000 * 3600 * 24;
    const minTime = minDate.getTime();
    const maxTime = maxDate.getTime();
    const activeIntervals = calculatedProjects
      .filter((project) => !project.muted)
      .map((project) => ({
        start: Math.max(project.start.getTime(), minTime),
        end: Math.min(project.end.getTime(), maxTime),
      }))
      .filter((interval) => interval.end >= minTime && interval.start <= maxTime)
      .sort((a, b) => a.start - b.start);

    if (activeIntervals.length === 0) return [];

    const gaps: { left: number; width: number; m2: number }[] = [];
    const createGap = (startTime: number, endExclusiveTime: number) => ({
      left: ((startTime - minTime) / dayMs) * dayWidth,
      width: ((endExclusiveTime - startTime) / dayMs) * dayWidth,
      m2: calculateProductionM2(
        new Date(startTime),
        new Date(endExclusiveTime),
        activeRatePoints
      ),
    });
    let cursor = minTime;

    activeIntervals.forEach((interval) => {
      if (interval.start > cursor) {
        gaps.push(createGap(cursor, interval.start));
      }
      cursor = Math.max(cursor, interval.end + dayMs);
    });

    if (cursor <= maxTime) {
      gaps.push(createGap(cursor, maxTime + dayMs));
    }

    return gaps.filter((gap) => gap.width >= 1);
  }, [activeRatePoints, calculatedProjects, dayWidth, minDate, maxDate, isRangeTooLarge]);

  // --- Project summary for header hover ---------------------------------------------------------
  const projectSummary = useMemo(() => {
    // Ignore muted projects when calculating the summary
    const activeProjects = visibleProjects.filter((p) => !p.muted);
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
  }, [visibleProjects]);


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
  }, [calculatedProjects, dayWidth, minDate, showGantt, isCompact]);

  const projectLeft = (project: { start: Date }) =>
    ((project.start.getTime() - minDate.getTime()) / DAY_MS) * dayWidth;

  const shiftedDayOffset = (project: { start: Date }, dx: number) =>
    Math.max(0, Math.round((projectLeft(project) + dx) / dayWidth));


  const reorderPreview = useMemo(() => {
    if (!drag?.active || drag.mode !== 'reorder') return null;
    const originIndex = calculatedProjects.findIndex((project) => project.id === drag.projectId);
    if (originIndex < 0) return null;
    return {
      projectId: drag.projectId,
      originIndex,
      dy: drag.dy,
      slot: visibleReorderSlot(originIndex, drag.dy),
    };
  }, [drag, calculatedProjects, hiddenLeadingRows]);

  // A drop slot never lands among the hidden rows above the first visible one.
  function visibleReorderSlot(originIndex: number, dy: number) {
    return Math.max(hiddenLeadingRows, reorderSlot(originIndex, dy, calculatedProjects.length));
  }

  const rowTop = (projectId: number, index: number) => {
    const visibleIndex = (i: number) => (i - hiddenLeadingRows) * rowHeight;
    if (!reorderPreview) return visibleIndex(index);
    const { originIndex, slot, dy } = reorderPreview;
    if (projectId === reorderPreview.projectId) return visibleIndex(originIndex) + dy;
    const indexWithoutDragged = index < originIndex ? index : index - 1;
    return visibleIndex(indexWithoutDragged < slot ? indexWithoutDragged : indexWithoutDragged + 1);
  };

  const handleBarPointerDown = (event: React.PointerEvent<HTMLDivElement>, projectId: number) => {
    // Touch keeps tap-to-open and long-press menus; dragging would fight scrolling.
    if (!isEditingEnabled || event.pointerType !== 'mouse' || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      projectId,
      pointerId: event.pointerId,
      mode: event.ctrlKey || event.metaKey ? 'reorder' : 'shift',
      startX: event.clientX,
      startY: event.clientY,
      dx: 0,
      dy: 0,
      active: false,
    };
  };

  const handleBarPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.active && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    if (!current.active) onInteractionChange?.(true);
    const next = { ...current, dx, dy, active: true };
    dragRef.current = next;
    setDrag(next);
  };

  const finishBarDrag = (event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDrag(null);
    if (!current.active) return;

    suppressProjectClickRef.current = true;
    window.setTimeout(() => { suppressProjectClickRef.current = false; }, 0);
    onInteractionChange?.(false);
    if (!commit || dayWidth <= 0) return;

    const originIndex = calculatedProjects.findIndex((project) => project.id === current.projectId);
    const project = calculatedProjects[originIndex];
    if (!project) return;
    if (current.mode === 'shift') {
      const newStart = addDays(minDate, shiftedDayOffset(project, current.dx));
      if (newStart.getTime() !== project.start.getTime()) onProjectUpdate(project.id, newStart);
      return;
    }
    const targetIndex = moveTargetIndex(
      projects,
      calculatedProjects.map((item) => item.id),
      project.id,
      visibleReorderSlot(originIndex, current.dy)
    );
    if (targetIndex !== null) onProjectMoveTo(project.id, targetIndex);
  };

  const handleBarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, project: Project) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onProjectOpen(project);
    } else if (isEditingEnabled && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      onProjectReorder(project.id, event.key === 'ArrowUp' ? 'move-up' : 'move-down');
    }
  };

  // Long-press on touch opens the menu without a contextmenu event on iOS, so
  // remember what was under the finger when it went down.
  const handleBodyPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') return;
    const projectElement = (event.target as HTMLElement).closest('[data-project-id]');
    const project = projectElement
      ? calculatedProjects.find((item) => item.id === Number(projectElement.getAttribute('data-project-id')))
      : undefined;
    const rect = ganttChartRef.current?.getBoundingClientRect();
    setContextMenuProject(project ?? null);
    setContextMenuDate(
      !project && rect && dayWidth > 0
        ? addDays(minDate, Math.floor((event.clientX - rect.left) / dayWidth))
        : null
    );
  };

  useEffect(() => {
    if (isEditingEnabled || !dragRef.current) return;
    dragRef.current = null;
    setDrag(null);
    onInteractionChange?.(false);
  }, [isEditingEnabled, onInteractionChange]);

  // On phones, open the timeline at the current month rather than the range start.
  const autoScrolledRangeRef = useRef<string | null>(null);
  const nowMilestoneLeft = timelineMilestones.find((milestone) => milestone.isNow)?.left;
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!isCompact || !scroller || dayWidth <= 0) return;
    const rangeKey = `${compactView}-${minDate.getTime()}-${maxDate.getTime()}`;
    if (autoScrolledRangeRef.current === rangeKey) return;
    autoScrolledRangeRef.current = rangeKey;
    scroller.scrollLeft = nowMilestoneLeft === undefined
      ? 0
      : Math.max(0, nowMilestoneLeft - COMPACT_MONTH_WIDTH_PX);
  }, [isCompact, compactView, dayWidth, minDate, maxDate, nowMilestoneLeft]);

  if (isRangeTooLarge) {
    return <div className="p-4 text-center text-red-500">El rango de fechas calculado es demasiado grande para mostrar.</div>;
  }

  return (
    <div
      ref={scrollerRef}
      className={isCompact
        ? "min-h-0 flex-1 overflow-auto overscroll-contain"
        : "flex min-h-full flex-col overflow-x-auto overscroll-x-contain"}
    >
    <div ref={timelineRef} className="flex min-h-full flex-1 flex-col" style={{ minWidth: minTimelineWidth }}>
      {showCapacity && <ProductionRateMonthly
        points={displayedPoints}
        onPointsChange={handleDisplayedPointsChange}
        onPointsSave={handleDisplayedPointsSave}
        minMonth={minMonth}
        maxMonth={maxMonth}
        minRate={rateRange.min}
        maxRate={rateRange.max}
        isRateRangeCustom={Boolean(rateRangeOverrides[rateView])}
        onRateRangeChange={handleRateRangeChange}
        onRateRangeReset={handleRateRangeReset}
        rateView={rateView}
        onRateViewChange={setRateView}
        monthPositions={monthPositions}
        isEditingEnabled={isEditingEnabled}
        onInteractionChange={onInteractionChange}
        compact={isCompact}
        height={isCompact ? compactChartHeight : undefined}
      />}

      <HoverCard>
        <HoverCardTrigger asChild>
          <div
            ref={monthHeaderRef}
            className={cn(
              "gantt-header relative grid w-full min-w-full bg-muted border-b border-border text-[10px] font-bold uppercase tracking-wide text-muted-foreground overflow-hidden",
              isCompact && showGantt && "sticky top-0 z-20"
            )}
            style={{
              gridTemplateColumns: `${monthHeaders
                .map((m) => `${m.width}px`)
                .join(' ')}`,
            }}
          >
            {monthHeaders.map(({ date, width }, index) => {
              const showYear = date.getMonth() === 0 || index === 0;
              // Narrow months (a whole range on a phone): stack a short year under
              // the month, and fall back to its initial when even that is too wide.
              if (width < 40) {
                return (
                  <div
                    key={date.toISOString()}
                    className={cn(
                      "flex min-w-0 flex-col items-center overflow-hidden border-r border-border/60 text-center leading-tight",
                      isCompact ? "pb-3 pt-1" : "pb-4 pt-1.5"
                    )}
                  >
                    <span>{width < 22 ? monthAbbr[date.getMonth()][0] : monthAbbr[date.getMonth()]}</span>
                    {showYear && (
                      <span className="text-[8px] text-amber-700 dark:text-amber-400">
                        {String(date.getFullYear()).slice(2)}
                      </span>
                    )}
                  </div>
                );
              }
              return (
                <div
                  key={date.toISOString()}
                  className={cn(
                    "flex items-start justify-center border-r border-border/60 px-1 text-center",
                    isCompact ? "pb-3 pt-1" : "pb-4 pt-1.5"
                  )}
                >
                  {monthAbbr[date.getMonth()]}
                  {showYear && ` ${date.getFullYear()}`}
                </div>
              );
            })}
            {timelineMilestones.map((milestone) => (
              <div
                key={milestone.key}
                className={cn(
                  'gantt-milestone-header absolute inset-y-0 pointer-events-none',
                  milestone.isNow && 'gantt-milestone-header-now'
                )}
                style={{ left: `${milestone.left}px` }}
                role="img"
                aria-label={`${milestone.description}: ${milestone.formattedDate}`}
                title={`${milestone.description} · ${milestone.formattedDate}`}
              >
                <span>{milestone.label}</span>
              </div>
            ))}
          </div>
        </HoverCardTrigger>
        <HoverCardContent className="w-[800px] max-w-[calc(100vw-2rem)] max-h-none overflow-visible bg-popover text-popover-foreground z-40 rounded-none" side="top" align="center" sideOffset={10}>
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
                  {visibleProjects.map((p) => (
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

      {showGantt && <ContextMenu onOpenChange={(open) => {
        if (!open) {
          setContextMenuProject(null);
          setContextMenuDate(null);
        }
      }}>
        <ContextMenuTrigger asChild disabled={isCompact}>
          <div
            ref={ganttChartRef}
            className="gantt-body relative w-full min-w-full flex-1 bg-background overflow-hidden [-webkit-touch-callout:none]"
            style={{ minHeight: `${Math.max((rowProjects.length - hiddenLeadingRows) * rowHeight, isCompact ? 0 : 200)}px` }}
            onPointerDown={handleBodyPointerDown}
            onContextMenu={handleContainerContextMenu}
          >
            <div className="absolute inset-0 pointer-events-none">
              {noProductionGaps.map((gap, index) => {
                const formattedM2 = Math.round(gap.m2).toLocaleString('es-CL');
                const accessibleLabel = `Sin producción: ${formattedM2} m²`;

                return (
                  <div
                    key={`gap-${index}-${gap.left}`}
                    className="gantt-no-production-gap absolute top-0 bottom-0"
                    style={{
                      left: `${gap.left}px`,
                      width: `${gap.width}px`,
                    }}
                    aria-label={accessibleLabel}
                    role="img"
                    tabIndex={0}
                  >
                    <span className="gantt-no-production-gap-label">
                      {formattedM2} m²
                    </span>
                  </div>
                );
              })}
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
              {timelineMilestones.map((milestone) => (
                <div
                  key={milestone.key}
                  className={cn(
                    'gantt-milestone-line absolute top-0 bottom-0',
                    milestone.isNow && 'gantt-milestone-line-now'
                  )}
                  style={{ left: `${milestone.left}px` }}
                  aria-hidden="true"
                />
              ))}
            </div>
                {/* Hidden span for measuring text width */}
                <span 
                  ref={textMeasureRef}
                  className={cn("absolute opacity-0 pointer-events-none font-bold whitespace-nowrap", denseRows ? "text-[10px]" : "text-xs")}
                  style={{ top: '-1000px' }}
                />
                
                {reorderPreview && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-[1] border border-dashed border-primary/70 bg-primary/5"
                    style={{ top: `${(reorderPreview.slot - hiddenLeadingRows) * rowHeight}px`, height: `${rowHeight}px` }}
                    aria-hidden="true"
                  />
                )}
                {rowProjects.map((project, index) => {
                  if (index < hiddenLeadingRows) return null;
                  const isDragged = drag?.active === true && drag.projectId === project.id;
                  const shiftOffset = isDragged && drag.mode === 'shift' && dayWidth > 0
                    ? shiftedDayOffset(project, drag.dx)
                    : null;
                  const left = shiftOffset === null ? projectLeft(project) : shiftOffset * dayWidth;
                  const width = Math.max(0, project.duration * dayWidth - 2); // -2 for some horizontal padding
                  const measurement = textMeasurements[project.id];
                  const textFits = measurement?.fits ?? true;
                  const hasUnreadActivity = unreadBaseProjectIds.has(project.baseProjectId);

                  return (
                    <div
                      key={project.id}
                      className={cn(
                        "gantt-row grid absolute w-full",
                        isDragged ? "z-30" : reorderPreview && "transition-[top] duration-150 ease-out"
                      )}
                      style={{ gridTemplateColumns: `1fr`, top: `${rowTop(project.id, index)}px`, height: `${rowHeight}px` }}
                    >
                      <div
                        className="gantt-bars-container relative h-full pointer-events-none"
                      >
                        {shiftOffset !== null && (
                          <div className="absolute top-0 bottom-0 z-50 pointer-events-none" style={{ left: `${left}px` }}>
                            <div className="h-full w-px bg-primary/75"></div>
                            <div className="absolute -top-2 left-0 -translate-x-1/2 -translate-y-full bg-popover text-popover-foreground text-xs font-mono px-2.5 py-1.5 rounded-md border border-primary/20 shadow-md whitespace-nowrap">
                              {addDays(minDate, shiftOffset).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                            </div>
                          </div>
                        )}
                         <HoverCard>
                           <HoverCardTrigger asChild>
                             {/* This div acts as the hover trigger area and positions the draggable bar */}
                             <div
                               className={cn(
                                 'absolute z-[2] top-1/2 -translate-y-1/2 select-none pointer-events-auto',
                                 denseRows ? 'h-[14px] text-[10px]' : 'h-[22px] text-xs',
                                 { 'opacity-50': project.muted }
                               )}
                               style={{ left: `${left}px`, width: `${width}px` }}
                             >
                               {/* This inner div is the actual draggable element */}
                               <div
                                 role="button"
                                 tabIndex={0}
                                 aria-label={`${project.name}${hasUnreadActivity ? ". Actividad nueva." : ""}`}
                                 onClick={() => {
                                   if (suppressProjectClickRef.current) return;
                                   onProjectOpen(project);
                                 }}
                                 onKeyDown={(event) => handleBarKeyDown(event, project)}
                                 onPointerDown={(event) => handleBarPointerDown(event, project.id)}
                                 onPointerMove={handleBarPointerMove}
                                 onPointerUp={(event) => finishBarDrag(event, true)}
                                 onPointerCancel={(event) => finishBarDrag(event, false)}
                                 className={cn(
                                   "relative h-full w-full border px-2 flex items-center justify-center font-bold uppercase tracking-tight transition-colors transition-shadow rounded-none",
                                   denseRows ? "text-[10px]" : "text-xs",
                                    isEditingEnabled ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                                   isDragged && drag.mode === 'reorder' && "cursor-ns-resize ring-2 ring-primary/60",
                                   project.muted
                                     ? "project-bar-muted border-dashed"
                                     : "project-bar"
                                 )}
                                 style={getProjectBarStyle(project)}
                                 data-project-id={project.id}
                               >
                                 {hasUnreadActivity && (
                                   <span
                                     aria-hidden="true"
                                     className="pointer-events-none absolute -right-1 -top-1 z-20 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-background"
                                     title="Actividad nueva"
                                   />
                                 )}
                                 {textFits ? (
                                   <span className="truncate px-2 flex items-center justify-center h-full">
                                     {project.name}
                                   </span>
                                 ) : (
                                   <div className="relative h-full w-full">
                                     <span
                                       className={cn("absolute font-bold text-foreground px-2 whitespace-nowrap z-10", denseRows ? "py-0" : "py-1")}
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
                           <HoverCardContent className={cn("w-64 bg-popover text-popover-foreground rounded-none", drag?.active && "hidden")}>
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
                               {project.color && (
                                 <div className="flex items-center gap-2 pt-1">
                                   <span className="text-muted-foreground">Color</span>
                                   <span
                                     className="h-3 w-3 rounded-full border border-border"
                                     style={{ backgroundColor: project.color }}
                                   />
                                   <span className="font-semibold">{project.color}</span>
                                 </div>
                               )}
                               <div className="pt-1">
                                 <p className="font-semibold">Duración</p>
                                 <div className="flex justify-between text-muted-foreground pt-1">
                                   <span>{project.duration} días</span>
                                   <span>{(project.duration / 7).toFixed(1)} sem.</span>
                                   <span>{(project.duration / (365/12)).toFixed(1)} meses</span>
                                 </div>
                               </div>
                               {isEditingEnabled && (
                                 <p className="border-t border-border pt-2 text-[10px] text-muted-foreground">
                                   Arrastra para cambiar la fecha · Ctrl + arrastrar para reordenar
                                 </p>
                               )}
                             </div>
                           </HoverCardContent>
                         </HoverCard>
                      </div>
                    </div>
                  );
                })}

                {rowProjects.length === hiddenLeadingRows && (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                    {isEditingEnabled
                      ? 'No hay proyectos para mostrar. Haz clic derecho para añadir un proyecto.'
                      : 'No hay proyectos para mostrar.'}
                  </div>
                )}
              </div>
            </ContextMenuTrigger>
          <ContextMenuContent className="w-48">
            {!isEditingEnabled && (
              <>
                <ContextMenuLabel>Solo lectura</ContextMenuLabel>
                <ContextMenuSeparator />
              </>
            )}
            <>
              <ContextMenuItem onClick={() => handleProjectAction('add')} disabled={!isEditingEnabled}>
                <PlusCircle />
                Añadir proyecto
              </ContextMenuItem>
              {contextMenuProject && (
                <>
                  <ContextMenuItem onClick={() => handleProjectAction('edit')} disabled={!isEditingEnabled}>
                    <Pencil />
                    Editar proyecto
                  </ContextMenuItem>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <ArrowUpDown className="w-4 h-4 mr-2" />
                      Cambiar orden
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className="w-48">
                      <ContextMenuItem onClick={() => handleReorder('move-to-top')} disabled={!isEditingEnabled}>
                        <ArrowUpToLine className="mr-2" />
                        Mover al inicio
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => handleReorder('move-up')} disabled={!isEditingEnabled}>
                        <ArrowUp className="mr-2" />
                        Mover hacia arriba
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => handleReorder('move-down')} disabled={!isEditingEnabled}>
                        <ArrowDown className="mr-2" />
                        Mover hacia abajo
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => handleReorder('move-to-bottom')} disabled={!isEditingEnabled}>
                        <ArrowDownToLine className="mr-2" />
                        Mover al fondo
                      </ContextMenuItem>
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={handleMuteToggle} disabled={!isEditingEnabled}>
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
                    disabled={!isEditingEnabled}
                  >
                    <Trash2 />
                    Eliminar proyecto
                  </ContextMenuItem>
                </>
              )}
            </>
          </ContextMenuContent>
        </ContextMenu>}
    </div>
    </div>
  );
};







