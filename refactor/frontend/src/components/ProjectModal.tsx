import React, { useState, useEffect } from 'react';
import type { Project } from '../App';

interface ProjectModalProps {
  open: boolean;
  project: Project | null;
  initialDate: Date;
  onSubmit: (name: string, m2: number, gg: number, priority: number, start: Date) => void;
  onCancel: () => void;
}

export const ProjectModal: React.FC<ProjectModalProps> = ({ 
  open, 
  project, 
  initialDate, 
  onSubmit, 
  onCancel 
}) => {
  const formatDateInput = (d: Date) => d.toISOString().split('T')[0];

  const [name, setName] = useState(project?.name || '');
  const [m2, setM2] = useState(project?.m2.toString() || '');
  const [ggStr, setGgStr] = useState(project?.gg?.toString() || '4.5');
  const [priorityStr, setPriorityStr] = useState(project?.priority?.toString() || '10');
  const [startStr, setStartStr] = useState(formatDateInput(initialDate));
  
  useEffect(() => {
    if (project) {
      setName(project.name);
      setM2(project.m2.toString());
      setGgStr(project.gg.toString());
      setPriorityStr((project.priority ?? 10).toString());
    } else {
      setName('');
      setM2('');
      setStartStr(formatDateInput(initialDate));
      setGgStr('4.5');
      setPriorityStr('10');
    }
  }, [project, open, initialDate]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border p-6 rounded-lg w-96 shadow-lg">
        <h2 className="text-xl font-bold mb-4 text-foreground">
          {project ? 'Editar Proyecto' : 'Agregar Nuevo Proyecto'}
        </h2>
        
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1 text-foreground">Nombre del Proyecto</label>
          <input
            type="text"
            className="border border-border rounded w-full p-2 bg-background text-foreground focus:border-amber-500 focus:outline-none"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1 text-foreground">Tamaño (m²)</label>
          <input
            type="number"
            className="border border-border rounded w-full p-2 bg-background text-foreground focus:border-amber-500 focus:outline-none"
            value={m2}
            onChange={e => setM2(e.target.value)}
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1 text-foreground">GG</label>
          <input
            type="number"
            step="0.1"
            className="border border-border rounded w-full p-2 bg-background text-foreground focus:border-amber-500 focus:outline-none"
            value={ggStr}
            onChange={e => setGgStr(e.target.value)}
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1 text-foreground">Prioridad</label>
          <input
            type="number"
            className="border border-border rounded w-full p-2 bg-background text-foreground focus:border-amber-500 focus:outline-none"
            value={priorityStr}
            min="1"
            onChange={e => setPriorityStr(e.target.value)}
          />
        </div>
        
        {!project && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1 text-foreground">Fecha de Inicio</label>
            <input
              type="date"
              className="border border-border rounded w-full p-2 bg-background text-foreground focus:border-amber-500 focus:outline-none"
              value={startStr}
              onChange={e => setStartStr(e.target.value)}
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
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
            onClick={() => {
              const parsedM2 = parseInt(m2, 10);
              const parsedGg = parseFloat(ggStr);
              const parsedPriority = parseInt(priorityStr, 10);
              if (
                name.trim() &&
                !isNaN(parsedM2) &&
                !isNaN(parsedGg) &&
                !isNaN(parsedPriority)
              ) {
                const selectedDate = project ? project.start : new Date(startStr);
                onSubmit(name, parsedM2, parsedGg, parsedPriority, selectedDate);
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
