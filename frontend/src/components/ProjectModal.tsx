import React, { useState, useEffect } from 'react';
import type { Project } from '../App';

interface ProjectModalProps {
  open: boolean;
  project: Project | null;
  initialDate: Date;
  onSubmit: (name: string, m2: number, gg: number, start: Date) => void;
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
  const [startStr, setStartStr] = useState(formatDateInput(initialDate));
  
  useEffect(() => {
    if (project) {
      setName(project.name);
      setM2(project.m2.toString());
      setGgStr(project.gg.toString());
    } else {
      setName('');
      setM2('');
      setStartStr(formatDateInput(initialDate));
      setGgStr('4.5');
    }
  }, [project, open, initialDate]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card p-6 rounded-lg w-96">
        <h2 className="text-xl font-bold mb-4 text-foreground">
          {project ? 'Edit Project' : 'Add New Project'}
        </h2>
        
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1 text-foreground">Project Name</label>
          <input
            type="text"
            className="border rounded w-full p-2 bg-input text-foreground"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1 text-foreground">Size (m²)</label>
          <input
            type="number"
            className="border rounded w-full p-2 bg-input text-foreground"
            value={m2}
            onChange={e => setM2(e.target.value)}
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1 text-foreground">GG</label>
          <input
            type="number"
            step="0.1"
            className="border rounded w-full p-2 bg-input text-foreground"
            value={ggStr}
            onChange={e => setGgStr(e.target.value)}
          />
        </div>
        
        {!project && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1 text-foreground">Start Date</label>
            <input
              type="date"
              className="border rounded w-full p-2 bg-input text-foreground"
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
            Cancel
          </button>
          <button
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
            onClick={() => {
              const parsedM2 = parseInt(m2, 10);
              const parsedGg = parseFloat(ggStr);
              if (name.trim() && !isNaN(parsedM2) && !isNaN(parsedGg)) {
                const selectedDate = project ? project.start : new Date(startStr);
                onSubmit(name, parsedM2, parsedGg, selectedDate);
              }
            }}
          >
            {project ? 'Save' : 'Add Project'}
          </button>
        </div>
      </div>
    </div>
  );
};
