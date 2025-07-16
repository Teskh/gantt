import React from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ChevronDown, Copy, Plus, Trash } from 'lucide-react'; // Changed from @radix-ui/react-icons
import { ModeToggle } from './ui/mode-toggle';

export interface Scenario {
  id: number;
  name: string;
}

interface ScenarioManagerProps {
  scenarios: Scenario[];
  activeScenario: Scenario | null;
  onScenarioChange: (scenarioId: number) => void;
  onScenarioCreate: () => void;
  onScenarioCopy: (scenarioId: number) => void;
  onScenarioDelete: (scenarioId: number) => void;
  isEditingScenarioName: boolean;
  scenarioNameDraft: string;
  onScenarioNameDraftChange: (value: string) => void;
  onScenarioNameSave: () => void;
  onScenarioNameEditStart: () => void;
  onScenarioNameEditCancel: () => void;
}

export const ScenarioManager: React.FC<ScenarioManagerProps> = ({
  scenarios,
  activeScenario,
  onScenarioChange,
  onScenarioCreate,
  onScenarioCopy,
  onScenarioDelete,
  isEditingScenarioName,
  scenarioNameDraft,
  onScenarioNameDraftChange,
  onScenarioNameSave,
  onScenarioNameEditStart,
  onScenarioNameEditCancel,
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
    <div className="bg-card p-2 rounded-lg shadow mb-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium text-muted-foreground">Escenario:</span>
        {isEditingScenarioName ? (
          <input
            className="h-10 w-64 rounded-md border bg-transparent px-3 py-2 text-sm"
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
          <div className="flex h-10 w-64 items-center justify-between rounded-md border bg-background text-foreground shadow-sm">
            <span
              className="flex-grow text-left truncate px-3 py-2 cursor-pointer"
              onClick={onScenarioNameEditStart}
            >
              {activeScenario?.name ?? 'Seleccionar un escenario'}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-full rounded-l-none">
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
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onScenarioCreate} size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Nuevo
        </Button>
        <Button onClick={handleCopy} size="sm" variant="outline" disabled={!activeScenario}>
          <Copy className="mr-2 h-4 w-4" />
          Copiar
        </Button>
        <Button onClick={handleDelete} size="sm" variant="destructive" disabled={!activeScenario}>
          <Trash className="mr-2 h-4 w-4" />
          Eliminar
        </Button>
        <ModeToggle />
      </div>
    </div>
  );
};
