import React from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ChevronDown, Copy, PlusSquare, Trash } from 'lucide-react';
import { ModeToggle } from './ui/mode-toggle';

export interface Scenario {
  id: number;
  name: string;
}

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
}

export const ScenarioManager: React.FC<ScenarioManagerProps> = ({
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
}) => {
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

  return (
    <header className="h-12 border-b border-border bg-muted/40 px-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
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
                className="flex-grow cursor-pointer truncate px-2 text-sm"
                onClick={onScenarioNameEditStart}
              >
                {activeScenario?.name ?? 'Seleccionar un escenario'}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none">
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
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
            </div>
          )}
          <button
            type="button"
            className="h-8 w-8 border-l border-border text-muted-foreground hover:text-foreground disabled:opacity-40"
            onClick={handleCopy}
            disabled={!activeScenario}
          >
            <Copy className="mx-auto h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="h-8 w-8 border-l border-border text-muted-foreground hover:text-red-600 disabled:opacity-40"
            onClick={handleDelete}
            disabled={!activeScenario}
          >
            <Trash className="mx-auto h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="h-8 w-8 border-l border-border text-muted-foreground hover:text-foreground"
            onClick={() => onScenarioCreate()}
          >
            <PlusSquare className="mx-auto h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex h-8 items-center gap-2 rounded border border-border bg-muted/70 px-2">
          <span className="text-[10px] font-bold uppercase text-muted-foreground">
            Rango
          </span>
          <div className="flex items-center gap-1 text-[10px] font-bold uppercase text-muted-foreground">
            <input
              type="month"
              value={rangeStart}
              onChange={(e) => onRangeStartChange(e.target.value)}
              className="h-7 rounded bg-transparent px-2 text-[11px] font-semibold text-foreground outline-none focus:ring-1 focus:ring-amber-500/60"
            />
            <span>→</span>
            <input
              type="month"
              value={rangeEnd}
              onChange={(e) => onRangeEndChange(e.target.value)}
              className="h-7 rounded bg-transparent px-2 text-[11px] font-semibold text-foreground outline-none focus:ring-1 focus:ring-amber-500/60"
            />
          </div>
        </div>

      </div>
      <div className="flex items-center gap-3 text-[10px] uppercase tracking-wide text-muted-foreground">
        <ModeToggle />
      </div>
    </header>
  );
};
