import React, { useEffect, useRef, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme-context';
import { cn } from '@/lib/utils';
import {
  CalendarRange,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  History,
  LogOut,
  Menu,
  Moon,
  PlusSquare,
  RotateCcw,
  Sun,
  Trash,
  User,
  Users,
} from 'lucide-react';
import { ModeToggle } from './ui/mode-toggle';
import { MobileFullscreenButton } from './MobileFullscreenButton';

export interface Scenario {
  id: number;
  name: string;
  revision: number;
}

export type CompactView = 'gantt' | 'capacity';

interface ScenarioManagerProps {
  scenarios: Scenario[];
  activeScenario: Scenario | null;
  onScenarioChange: (scenarioId: number) => void;
  onScenarioCopy: (scenarioId: number) => void;
  onScenarioDelete: (scenarioId: number) => void;
  onScenarioCreate: (name?: string) => void;
  isEditingScenarioName: boolean;
  scenarioNameDraft: string;
  onScenarioNameDraftChange: (value: string) => void;
  onScenarioNameSave: () => void;
  onScenarioNameEditStart: () => void;
  onScenarioNameEditCancel: () => void;
  rangeStart: string;
  rangeEnd: string;
  onRangeStartChange: (value: string) => void;
  onRangeEndChange: (value: string) => void;
  isPersonalRange: boolean;
  onRangeReset: () => void;
  hasRemoteChanges: boolean;
  onApplyRemoteChanges: () => void;
  currentUser: { email: string; displayName: string; canEdit: boolean; isAdmin: boolean };
  onOpenActivity: () => void;
  onOpenUsers: () => void;
  onLogout: () => void;
  compact: boolean;
  compactView: CompactView;
  onCompactViewChange: (view: CompactView) => void;
  hideMuted: boolean;
  onHideMutedChange: (hide: boolean) => void;
}

const headerButtonClass =
  'inline-flex h-8 items-center gap-1 px-2 hover:text-foreground';

const monthInputClass =
  'h-7 rounded bg-transparent px-2 text-[11px] font-semibold text-foreground outline-none focus:ring-1 focus:ring-amber-500/60';

const MONTH_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const shortMonth = (value: string) => {
  const [year, month] = value.split('-').map(Number);
  return year && month ? `${MONTH_ABBR[month - 1]} ${String(year).slice(2)}` : value;
};

function ScenarioPicker({
  scenarios,
  activeScenario,
  onScenarioChange,
  trigger,
}: Pick<ScenarioManagerProps, 'scenarios' | 'activeScenario' | 'onScenarioChange'> & { trigger: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuRadioGroup
          value={activeScenario?.id.toString()}
          onValueChange={(id) => onScenarioChange(Number(id))}
        >
          {scenarios.map((scenario) => (
            <DropdownMenuRadioItem key={scenario.id} value={scenario.id.toString()}>
              {scenario.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Phone header: one slim bar that leaves the screen to the chart. Phones are
// read-only, so it only offers navigation: scenario, view, range and a menu.
function CompactHeader(props: ScenarioManagerProps) {
  const {
    activeScenario,
    rangeStart,
    rangeEnd,
    onRangeStartChange,
    onRangeEndChange,
    isPersonalRange,
    onRangeReset,
    currentUser,
    onOpenActivity,
    onLogout,
    compactView,
    onCompactViewChange,
    hideMuted,
    onHideMutedChange,
  } = props;
  const { theme, setTheme } = useTheme();
  const [rangeOpen, setRangeOpen] = useState(false);
  const rangeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rangeOpen) return;
    const close = (event: PointerEvent) => {
      if (!rangeRef.current?.contains(event.target as Node)) setRangeOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [rangeOpen]);

  return (
    <header className="mobile-header flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-muted/40 px-2 py-1">
      <span className="text-sm font-bold tracking-tight text-amber-600">PLAN</span>

      <ScenarioPicker
        {...props}
        trigger={
          <button
            type="button"
            className="flex h-7 min-w-0 flex-1 items-center justify-between gap-1 rounded border border-border bg-muted/70 px-2 text-xs text-foreground sm:max-w-[40vw] sm:flex-none"
            aria-label="Cambiar escenario"
          >
            <span className="truncate">{activeScenario?.name ?? 'Escenario'}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        }
      />

      {/* Portrait: view switch and range go to a second row. */}
      <div className="order-last h-0 basis-full sm:hidden" aria-hidden="true" />
      <div
        role="radiogroup"
        aria-label="Vista"
        className="order-last inline-flex h-7 flex-1 border border-border bg-background text-[10px] font-bold uppercase tracking-wide sm:order-none sm:flex-none"
      >
        {([
          ['gantt', 'Gantt'],
          ['capacity', 'Capacidad'],
        ] as const).map(([view, label]) => (
          <button
            key={view}
            type="button"
            role="radio"
            aria-checked={compactView === view}
            onClick={() => onCompactViewChange(view)}
            className={cn(
              'flex-1 px-3 transition-colors',
              compactView === view ? 'bg-amber-500 text-amber-950' : 'text-muted-foreground'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div ref={rangeRef} className="relative order-last sm:order-none">
        <button
          type="button"
          onClick={() => setRangeOpen((open) => !open)}
          aria-expanded={rangeOpen}
          aria-haspopup="dialog"
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded border px-2 text-[11px] font-semibold tabular-nums',
            isPersonalRange
              ? 'border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200'
              : 'border-border bg-muted/70 text-foreground'
          )}
        >
          <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" />
          {shortMonth(rangeStart)} – {shortMonth(rangeEnd)}
        </button>
        {rangeOpen && (
          <div
            role="dialog"
            aria-label="Rango de fechas"
            className="absolute right-0 top-full z-50 mt-1 w-64 border border-border bg-background p-3 shadow-lg"
          >
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Rango (solo tu vista)</p>
            <label className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              Desde
              <input type="month" value={rangeStart} onChange={(e) => onRangeStartChange(e.target.value)} className={cn(monthInputClass, 'border border-border')} />
            </label>
            <label className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              Hasta
              <input type="month" value={rangeEnd} onChange={(e) => onRangeEndChange(e.target.value)} className={cn(monthInputClass, 'border border-border')} />
            </label>
            {isPersonalRange && (
              <button
                type="button"
                onClick={() => { onRangeReset(); setRangeOpen(false); }}
                className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300"
              >
                <RotateCcw className="h-3 w-3" />
                Volver al rango compartido
              </button>
            )}
          </div>
        )}
      </div>

      {compactView === 'gantt' && (
        <button
          type="button"
          onClick={() => onHideMutedChange(!hideMuted)}
          aria-pressed={!hideMuted}
          title={hideMuted ? 'Mostrar proyectos silenciados' : 'Ocultar proyectos silenciados'}
          className={cn(
            'ml-auto inline-flex h-7 items-center gap-1 rounded border px-2 text-[10px] font-bold uppercase',
            hideMuted ? 'border-border text-muted-foreground' : 'border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200'
          )}
        >
          {hideMuted ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          Silenciados
        </button>
      )}
      <MobileFullscreenButton />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground',
              compactView !== 'gantt' && 'ml-auto'
            )}
            aria-label="Menú"
          >
            <Menu className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <span className="block truncate text-sm">{currentUser.displayName}</span>
            <span className="block truncate text-xs text-muted-foreground">{currentUser.email}</span>
            <span className="mt-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
              Solo lectura en el teléfono
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun /> : <Moon />}
            {theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}
          </DropdownMenuItem>
          {currentUser.isAdmin && (
            <DropdownMenuItem onSelect={onOpenActivity}>
              <History />
              Actividad
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onLogout}>
            <LogOut />
            Salir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

export const ScenarioManager: React.FC<ScenarioManagerProps> = (props) => {
  const {
    scenarios,
    activeScenario,
    onScenarioChange,
    onScenarioCopy,
    onScenarioDelete,
    onScenarioCreate,
    isEditingScenarioName,
    scenarioNameDraft,
    onScenarioNameDraftChange,
    onScenarioNameSave,
    onScenarioNameEditStart,
    onScenarioNameEditCancel,
    rangeStart,
    rangeEnd,
    onRangeStartChange,
    onRangeEndChange,
    isPersonalRange,
    onRangeReset,
    hasRemoteChanges,
    onApplyRemoteChanges,
    currentUser,
    onOpenActivity,
    onOpenUsers,
    onLogout,
    compact,
  } = props;
  const { canEdit, isAdmin } = currentUser;

  if (compact) return <CompactHeader {...props} />;

  const handleCopy = () => {
    if (activeScenario) {
      onScenarioCopy(activeScenario.id);
    }
  };

  const handleDelete = () => {
    if (activeScenario) {
      onScenarioDelete(activeScenario.id);
    }
  };

  // One 48px row on wide screens; narrower windows wrap instead of overlapping.
  return (
    <header className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-muted/40 px-4 py-2">
      <div className="text-amber-600 font-bold tracking-tight text-lg">
        PLANIFICACION
      </div>
      <div className="flex items-center rounded border border-border bg-muted/70">
        <span className="px-2 text-[10px] font-bold uppercase text-muted-foreground">
          Escenario
        </span>
        {isEditingScenarioName ? (
          <input
            className="h-8 w-64 bg-transparent px-2 text-sm text-foreground outline-none"
            value={scenarioNameDraft}
            autoFocus
            onChange={(e) => onScenarioNameDraftChange(e.target.value)}
            onBlur={onScenarioNameSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onScenarioNameSave();
              if (e.key === 'Escape') onScenarioNameEditCancel();
            }}
          />
        ) : (
          <div className="flex h-8 w-64 items-center justify-between text-foreground">
            <span
              className={`flex-grow truncate px-2 text-sm ${canEdit ? 'cursor-pointer' : ''}`}
              onClick={canEdit ? onScenarioNameEditStart : undefined}
              title={canEdit ? 'Renombrar escenario' : undefined}
            >
              {activeScenario?.name ?? 'Seleccionar un escenario'}
            </span>
            <ScenarioPicker
              scenarios={scenarios}
              activeScenario={activeScenario}
              onScenarioChange={onScenarioChange}
              trigger={
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none" aria-label="Cambiar escenario">
                  <ChevronDown className="h-4 w-4" />
                </Button>
              }
            />
          </div>
        )}
        {canEdit && (
          <>
            <button
              type="button"
              className="h-8 w-8 border-l border-border text-muted-foreground hover:text-foreground disabled:opacity-40"
              onClick={handleCopy}
              disabled={!activeScenario}
              title="Copiar escenario"
              aria-label="Copiar escenario"
            >
              <Copy className="mx-auto h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="h-8 w-8 border-l border-border text-muted-foreground hover:text-red-600 disabled:opacity-40"
              onClick={handleDelete}
              disabled={!activeScenario}
              title="Eliminar escenario"
              aria-label="Eliminar escenario"
            >
              <Trash className="mx-auto h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="h-8 w-8 border-l border-border text-muted-foreground hover:text-foreground disabled:opacity-40"
              onClick={() => onScenarioCreate()}
              title="Nuevo escenario"
              aria-label="Nuevo escenario"
            >
              <PlusSquare className="mx-auto h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

      {hasRemoteChanges && (
        <button
          type="button"
          onClick={onApplyRemoteChanges}
          className="h-8 border border-amber-500/40 bg-amber-500/10 px-3 text-[10px] font-bold uppercase text-amber-700 hover:bg-amber-500/20"
        >
          Hay cambios nuevos - actualizar
        </button>
      )}

      <div
        className="flex h-8 items-center gap-2 rounded border border-border bg-muted/70 px-2"
        title={canEdit ? 'Cambia el rango para todos los usuarios' : 'Cambia el rango solo en tu vista'}
      >
        <span className="text-[10px] font-bold uppercase text-muted-foreground">
          Rango
        </span>
        <div className="flex items-center gap-1 text-[10px] font-bold uppercase text-muted-foreground">
          <input
            type="month"
            value={rangeStart}
            onChange={(e) => onRangeStartChange(e.target.value)}
            aria-label="Inicio del rango"
            className={monthInputClass}
          />
          <span>→</span>
          <input
            type="month"
            value={rangeEnd}
            onChange={(e) => onRangeEndChange(e.target.value)}
            aria-label="Fin del rango"
            className={monthInputClass}
          />
        </div>
        {isPersonalRange && (
          <button
            type="button"
            onClick={onRangeReset}
            className="inline-flex h-6 items-center gap-1 border border-amber-500/40 bg-amber-500/10 px-1.5 text-[9px] font-bold uppercase text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
            title="Volver al rango compartido"
          >
            <RotateCcw className="h-3 w-3" />
            Tu vista
          </button>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span className="hidden max-w-52 items-center gap-1.5 normal-case tracking-normal text-foreground lg:flex" title={currentUser.email}>
          <User className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate">{currentUser.displayName}</span>
        </span>
        {!canEdit && (
          <span
            className="border border-border px-1.5 py-0.5 text-[9px] font-bold"
            title="Puedes ver la planificación pero no modificarla"
          >
            Solo lectura
          </span>
        )}
        {isAdmin && (
          <button type="button" onClick={onOpenUsers} className={headerButtonClass}>
            <Users className="h-3.5 w-3.5" />
            Usuarios
          </button>
        )}
        {isAdmin && (
          <button type="button" onClick={onOpenActivity} className={headerButtonClass}>
            <History className="h-3.5 w-3.5" />
            Actividad
          </button>
        )}
        <button type="button" onClick={onLogout} className={headerButtonClass} title="Cerrar sesion">
          <LogOut className="h-3.5 w-3.5" />
          Salir
        </button>
        <ModeToggle />
      </div>
    </header>
  );
};
