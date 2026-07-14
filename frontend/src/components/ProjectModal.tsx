import React, { useState, useEffect } from 'react';
import type { Project } from '../App';

interface ProjectModalProps {
  open: boolean;
  project: Project | null;
  initialDate: Date;
  onSubmit: (name: string, m2: number, gg: number, priority: number, start: Date, color: string | null) => void;
  onCancel: () => void;
  canEdit: boolean;
}

const PROJECT_COLOR_OPTIONS = [
  { label: 'Azul', value: '#0ea5e9' },
  { label: 'Verde', value: '#10b981' },
  { label: 'Amarillo', value: '#f59e0b' },
  { label: 'Rojo', value: '#ef4444' },
];

const isPresetColor = (value: string) =>
  PROJECT_COLOR_OPTIONS.some((option) => option.value === value);

export const ProjectModal: React.FC<ProjectModalProps> = ({
  open,
  project,
  initialDate,
  onSubmit,
  onCancel,
  canEdit,
}) => {
  const formatDateInput = (d: Date) => d.toISOString().split('T')[0];

  const [name, setName] = useState(project?.name || '');
  const [m2, setM2] = useState(project?.m2.toString() || '');
  const [ggStr, setGgStr] = useState(project?.gg?.toString() || '4.5');
  const [priorityStr, setPriorityStr] = useState(project?.priority?.toString() || '10');
  const [startStr, setStartStr] = useState(formatDateInput(initialDate));
  const [color, setColor] = useState(
    project?.color && isPresetColor(project.color) ? project.color : ''
  );
  const [useCustomColor, setUseCustomColor] = useState(Boolean(project?.color));

  useEffect(() => {
    if (project) {
      setName(project.name);
      setM2(project.m2.toString());
      setGgStr(project.gg.toString());
      setPriorityStr((project.priority ?? 10).toString());
      const presetColor = project.color && isPresetColor(project.color) ? project.color : '';
      setColor(presetColor);
      setUseCustomColor(Boolean(presetColor));
    } else {
      setName('');
      setM2('');
      setStartStr(formatDateInput(initialDate));
      setGgStr('4.5');
      setPriorityStr('10');
      setColor('');
      setUseCustomColor(false);
    }
  }, [project, open, initialDate]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border p-6 rounded-lg w-[440px] max-h-[90vh] overflow-y-auto shadow-lg">
        <h2 className="text-xl font-bold mb-4 text-foreground">
          {project ? 'Editar Proyecto' : 'Agregar Nuevo Proyecto'}
        </h2>

        {!canEdit && (
          <div className="mb-4 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
            Edicion bloqueada. Usa el candado para habilitar cambios.
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1 text-foreground">Nombre del Proyecto</label>
          <input
            type="text"
            className="border border-border rounded w-full p-2 bg-background text-foreground focus:border-amber-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={!canEdit}
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1 text-foreground">Tamaño (m²)</label>
          <input
            type="number"
            min="1"
            className="border border-border rounded w-full p-2 bg-background text-foreground focus:border-amber-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
            value={m2}
            onChange={e => setM2(e.target.value)}
            disabled={!canEdit}
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1 text-foreground">GG</label>
          <input
            type="number"
            min="0.1"
            step="0.1"
            className="border border-border rounded w-full p-2 bg-background text-foreground focus:border-amber-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
            value={ggStr}
            onChange={e => setGgStr(e.target.value)}
            disabled={!canEdit}
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1 text-foreground">Prioridad</label>
          <input
            type="number"
            className="border border-border rounded w-full p-2 bg-background text-foreground focus:border-amber-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
            value={priorityStr}
            min="1"
            onChange={e => setPriorityStr(e.target.value)}
            disabled={!canEdit}
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1 text-foreground">Color del Item</label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`h-8 rounded border px-3 text-xs font-semibold uppercase ${!useCustomColor ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-secondary text-secondary-foreground hover:bg-secondary/80'} disabled:cursor-not-allowed disabled:opacity-60`}
              onClick={() => {
                setUseCustomColor(false);
                setColor('');
              }}
              disabled={!canEdit}
            >
              Default
            </button>
            {PROJECT_COLOR_OPTIONS.map((option) => {
              const selected = useCustomColor && color === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`flex h-8 items-center gap-2 rounded border px-3 text-xs font-semibold uppercase ${selected ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-background text-foreground hover:bg-muted'} disabled:cursor-not-allowed disabled:opacity-60`}
                  onClick={() => {
                    setUseCustomColor(true);
                    setColor(option.value);
                  }}
                  disabled={!canEdit}
                >
                  <span
                    className="h-3 w-3 rounded-full border border-border"
                    style={{ backgroundColor: option.value }}
                  />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        {!project && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1 text-foreground">Fecha de Inicio</label>
            <input
              type="date"
              className="border border-border rounded w-full p-2 bg-background text-foreground focus:border-amber-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
              value={startStr}
              onChange={e => setStartStr(e.target.value)}
              disabled={!canEdit}
            />
          </div>
        )}

        <div className="flex justify-end space-x-2">
          <button
            className="px-4 py-2 border rounded bg-secondary text-secondary-foreground hover:bg-secondary/80"
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={!canEdit}
            onClick={() => {
              if (!canEdit) return;
              const parsedM2 = parseInt(m2, 10);
              const parsedGg = parseFloat(ggStr);
              const parsedPriority = parseInt(priorityStr, 10);
              if (
                name.trim() &&
                !isNaN(parsedM2) &&
                !isNaN(parsedGg) &&
                !isNaN(parsedPriority) &&
                parsedM2 > 0 &&
                parsedGg > 0 &&
                parsedPriority > 0
              ) {
                const selectedDate = project ? project.start : new Date(startStr);
                onSubmit(
                  name,
                  parsedM2,
                  parsedGg,
                  parsedPriority,
                  selectedDate,
                  useCustomColor && isPresetColor(color) ? color : null
                );
              }
            }}
          >
            {project ? 'Guardar' : 'Agregar Proyecto'}
          </button>
        </div>
      </div>
    </div>
  );
};
