import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  MessageSquareText,
  Pencil,
  Plus,
  Send,
  Settings2,
  X,
} from "lucide-react";
import type { Project } from "@/App";
import { apiFetch, apiRequest } from "@/lib/api";
import { readProjectCardMutation } from "@/lib/project-card-mutation";
import type { ProjectActivityEntry, ProjectCardData } from "@/lib/project-tracking";
import { StatusSettingsDialog } from "./StatusSettingsDialog";

interface ProjectActivityCardProps {
  project: Project | null;
  onClose: () => void;
  onEdit: (project: Project) => void;
}

const formatActivityTime = (value: string) =>
  new Date(value).toLocaleString("es-CL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const activitySentence = (entry: ProjectActivityEntry) => {
  if (entry.kind === "note") return null;
  const from = entry.fromOptionLabel || "Sin estado";
  const to = entry.toOptionLabel || "Sin estado";
  return `cambió ${entry.definitionName || "el estado"} de ${from} a ${to}.`;
};

const sameCardData = (current: ProjectCardData | null, incoming: ProjectCardData) =>
  current !== null && JSON.stringify(current) === JSON.stringify(incoming);

export function ProjectActivityCard({ project, onClose, onEdit }: ProjectActivityCardProps) {
  const [card, setCard] = useState<ProjectCardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [changingStatusId, setChangingStatusId] = useState<number | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const requestSequenceRef = useRef(0);
  const statusMutationInFlightRef = useRef(false);
  const activeProjectId = project?.id ?? null;
  const activeProjectIdRef = useRef(activeProjectId);
  const backgroundSyncPausedRef = useRef(false);

  activeProjectIdRef.current = activeProjectId;
  backgroundSyncPausedRef.current =
    settingsOpen || statusPickerOpen || savingNote || changingStatusId !== null;

  const loadCard = useCallback(async (silent = false) => {
    if (activeProjectId === null) return;
    const requestSequence = ++requestSequenceRef.current;
    if (!silent) setLoading(true);
    try {
      const data = await apiFetch<ProjectCardData>(`/api/projects/${activeProjectId}/card`);
      if (
        requestSequence !== requestSequenceRef.current ||
        activeProjectIdRef.current !== activeProjectId
      ) {
        return;
      }
      setCard((current) => sameCardData(current, data) ? current : data);
      if (!silent) setError(null);
      setSyncWarning(null);
    } catch (loadError) {
      console.error(loadError);
      if (
        !silent &&
        requestSequence === requestSequenceRef.current &&
        activeProjectIdRef.current === activeProjectId
      ) {
        setError("No se pudo cargar la ficha del proyecto.");
      } else if (
        silent &&
        requestSequence === requestSequenceRef.current &&
        activeProjectIdRef.current === activeProjectId
      ) {
        setSyncWarning("No se pudo actualizar la ficha. Los datos visibles podrían estar desactualizados.");
      }
    } finally {
      if (!silent && requestSequence === requestSequenceRef.current) setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    if (activeProjectId === null) {
      requestSequenceRef.current += 1;
      setCard(null);
      return;
    }
    setCard(null);
    setNote("");
    setStatusPickerOpen(false);
    void loadCard();
    const timer = window.setInterval(() => {
      const focusedElement = document.activeElement;
      const formControlFocused =
        focusedElement instanceof HTMLElement &&
        panelRef.current?.contains(focusedElement) &&
        focusedElement.matches("input, textarea, select");
      if (
        document.visibilityState !== "visible" ||
        backgroundSyncPausedRef.current ||
        formControlFocused
      ) {
        return;
      }
      void loadCard(true);
    }, 10_000);
    return () => {
      requestSequenceRef.current += 1;
      window.clearInterval(timer);
    };
  }, [activeProjectId, loadCard]);

  useEffect(() => {
    if (!project) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !settingsOpen) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [project, settingsOpen, onClose]);

  const assignedStatusIds = useMemo(
    () => new Set(card?.statuses.map((status) => status.definitionId) ?? []),
    [card]
  );
  const availableStatuses = useMemo(
    () => card?.availableDefinitions.filter(
      (definition) => !assignedStatusIds.has(definition.id)
    ) ?? [],
    [assignedStatusIds, card]
  );

  if (!project) return null;

  const beginStatusMutation = (definitionId: number) => {
    if (statusMutationInFlightRef.current) return false;
    statusMutationInFlightRef.current = true;
    setChangingStatusId(definitionId);
    return true;
  };

  const finishStatusMutation = () => {
    statusMutationInFlightRef.current = false;
    setChangingStatusId(null);
  };

  const applyMutationResponse = async (
    response: Response,
    fallbackMessage: string
  ) => {
    const payload = await readProjectCardMutation(response, fallbackMessage);
    if (payload.card) {
      requestSequenceRef.current += 1;
      setCard(payload.card);
      setSyncWarning(null);
      return;
    }
    await loadCard(true);
  };

  const addStatus = async (definitionId: number) => {
    if (!definitionId || !beginStatusMutation(definitionId)) return;
    setStatusPickerOpen(false);
    setError(null);
    try {
      const response = await apiRequest(`/api/projects/${project.id}/statuses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definitionId }),
      });
      await applyMutationResponse(response, "No se pudo asignar el estado.");
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "No se pudo asignar el estado.");
    } finally {
      finishStatusMutation();
    }
  };

  const updateStatus = async (definitionId: number, optionId: number) => {
    const current = card?.statuses.find((status) => status.definitionId === definitionId);
    if (!current || !beginStatusMutation(definitionId)) return;
    setError(null);
    try {
      const response = await apiRequest(`/api/projects/${project.id}/statuses/${definitionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId, expectedRevision: current.revision }),
      });
      await applyMutationResponse(response, "No se pudo actualizar el estado.");
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "No se pudo actualizar el estado.");
      await loadCard(true);
    } finally {
      finishStatusMutation();
    }
  };

  const removeStatus = async (definitionId: number, name: string) => {
    const current = card?.statuses.find((status) => status.definitionId === definitionId);
    if (
      !current ||
      !window.confirm(`¿Quitar “${name}” de este proyecto?`) ||
      !beginStatusMutation(definitionId)
    ) return;
    setError(null);
    try {
      const response = await apiRequest(`/api/projects/${project.id}/statuses/${definitionId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: current.revision }),
      });
      await applyMutationResponse(response, "No se pudo quitar el estado.");
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "No se pudo quitar el estado.");
      await loadCard(true);
    } finally {
      finishStatusMutation();
    }
  };

  const submitNote = async () => {
    const body = note.trim();
    if (!body) return;
    setSavingNote(true);
    setError(null);
    try {
      const response = await apiRequest(`/api/projects/${project.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      await applyMutationResponse(response, "No se pudo guardar la nota.");
      setNote("");
    } catch (noteError) {
      setError(noteError instanceof Error ? noteError.message : "No se pudo guardar la nota.");
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[65] flex justify-end bg-black/35" onMouseDown={onClose}>
        <aside
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-card-title"
          className="flex h-full w-full max-w-xl flex-col border-l border-border bg-background"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="shrink-0 border-b border-border">
            <div className="flex items-start justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-600">Ficha de proyecto</p>
                <h2 id="project-card-title" className="mt-1 truncate text-lg font-bold">{project.name}</h2>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => onEdit(project)}
                  className="inline-flex h-8 items-center gap-1 border border-border px-2 text-xs font-semibold hover:border-amber-500"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Editar datos
                </button>
                <button type="button" onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground" aria-label="Cerrar">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-4 border-t border-border text-[11px] tabular-nums">
              <div className="border-r border-border px-3 py-2">
                <span className="block text-muted-foreground">Inicio</span>
                <span className="mt-0.5 block font-semibold">{project.start.toLocaleDateString("es-CL")}</span>
              </div>
              <div className="border-r border-border px-3 py-2">
                <span className="block text-muted-foreground">Superficie</span>
                <span className="mt-0.5 block font-semibold">{project.m2.toLocaleString("es-CL")} m²</span>
              </div>
              <div className="border-r border-border px-3 py-2">
                <span className="block text-muted-foreground">GG</span>
                <span className="mt-0.5 block font-semibold">{project.gg}</span>
              </div>
              <div className="px-3 py-2">
                <span className="block text-muted-foreground">Prioridad</span>
                <span className="mt-0.5 block font-semibold">{project.priority ?? 10}</span>
              </div>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <section className="border-b border-border px-5 py-5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-[0.16em]">Estados</h3>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="inline-flex h-8 items-center gap-1 border border-border px-2 text-xs font-semibold hover:border-amber-500"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  Configurar
                </button>
              </div>

              {loading && <p className="mt-4 text-xs text-muted-foreground">Cargando ficha...</p>}
              {!loading && card && card.statuses.length === 0 && (
                <div className="mt-4 border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                  Este proyecto todavía no tiene estados asignados.
                </div>
              )}
              <div className="mt-4 space-y-2">
                {card?.statuses.map((status) => (
                  <div key={status.definitionId} className="border border-border bg-card">
                    <div className="flex h-9 items-center justify-between border-b border-border px-3">
                      <label htmlFor={`status-${status.definitionId}`} className="text-xs font-semibold">
                        {status.name}
                      </label>
                      <button
                        type="button"
                        onClick={() => void removeStatus(status.definitionId, status.name)}
                        disabled={changingStatusId === status.definitionId}
                        className="inline-flex h-7 items-center gap-1 px-1 text-[11px] font-semibold text-muted-foreground hover:text-red-600 disabled:opacity-40"
                        aria-label={`Quitar ${status.name}`}
                      >
                        <X className="h-3 w-3" />
                        Quitar
                      </button>
                    </div>
                    <select
                      id={`status-${status.definitionId}`}
                      value={status.optionId ?? ""}
                      disabled={changingStatusId === status.definitionId}
                      onChange={(event) => void updateStatus(status.definitionId, Number(event.target.value))}
                      className="h-10 w-full min-w-0 bg-background px-3 text-xs outline-none focus:bg-amber-500/10 disabled:opacity-50"
                    >
                      <option value="" disabled>Asignado — seleccione un valor</option>
                      {status.options.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}{option.archived ? " (retirado)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {card && availableStatuses.length > 0 && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setStatusPickerOpen((open) => !open)}
                    disabled={changingStatusId !== null}
                    aria-expanded={statusPickerOpen}
                    className="inline-flex h-9 items-center gap-2 border border-border bg-background px-3 text-xs font-semibold hover:border-amber-500 hover:text-amber-700 disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Agregar estado
                  </button>
                  {statusPickerOpen && (
                    <div className="mt-2 border border-border bg-background">
                      <p className="border-b border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Estados disponibles
                      </p>
                      <div className="divide-y divide-border">
                        {availableStatuses.map((definition) => (
                          <button
                            key={definition.id}
                            type="button"
                            onClick={() => void addStatus(definition.id)}
                            disabled={changingStatusId !== null}
                            className="flex w-full items-center justify-between px-3 py-2.5 text-left text-xs font-semibold hover:bg-amber-500/10 disabled:opacity-40"
                          >
                            <span>{definition.name}</span>
                            <span className="text-[10px] uppercase tracking-wide text-amber-700">Agregar</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {syncWarning && (
                <p role="status" className="mt-3 border-l-2 border-amber-500 pl-3 text-xs text-amber-700 dark:text-amber-300">
                  {syncWarning}
                </p>
              )}
              {error && <p role="alert" className="mt-3 border-l-2 border-red-500 pl-3 text-xs text-red-600">{error}</p>}
            </section>

            <section className="px-5 py-5">
              <div className="flex items-center gap-2">
                <MessageSquareText className="h-4 w-4 text-amber-600" />
                <h3 className="text-xs font-bold uppercase tracking-[0.16em]">Nueva nota</h3>
              </div>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={5000}
                rows={3}
                placeholder="Escribe una actualización del proyecto..."
                className="mt-3 w-full resize-y border border-border bg-card px-3 py-3 text-sm leading-6 outline-none focus:border-amber-500"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[10px] tabular-nums text-muted-foreground">{note.length}/5000</span>
                <button
                  type="button"
                  onClick={() => void submitNote()}
                  disabled={!note.trim() || savingNote}
                  className="inline-flex h-9 items-center gap-2 border border-amber-600 bg-amber-600 px-4 text-xs font-bold text-slate-950 hover:bg-amber-500 disabled:opacity-40"
                >
                  <Send className="h-3.5 w-3.5" />
                  {savingNote ? "Guardando..." : "Agregar nota"}
                </button>
              </div>
            </section>

            <section className="border-t border-border px-5 py-5">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-xs font-bold uppercase tracking-[0.16em]">Actividad</h3>
              </div>
              {card && card.activity.length === 0 && (
                <p className="mt-4 border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
                  Todavía no hay actividad registrada para este proyecto.
                </p>
              )}
              <ol className="relative mt-4 border-l border-border pl-5">
                {card?.activity.map((entry) => {
                  const actor = entry.actorName || entry.actorEmail;
                  const sentence = activitySentence(entry);
                  return (
                    <li key={entry.id} className="relative pb-5 last:pb-0">
                      <span className={`absolute -left-[23px] top-1 h-[5px] w-[5px] ${entry.kind === "note" ? "bg-amber-500" : "bg-muted-foreground"}`} />
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="text-xs font-semibold" title={entry.actorEmail}>{actor}</span>
                        <time className="text-[10px] tabular-nums text-muted-foreground">{formatActivityTime(entry.occurredAt)}</time>
                      </div>
                      {entry.kind === "note" ? (
                        <p className="mt-2 whitespace-pre-wrap border border-border bg-card px-3 py-3 text-sm leading-6">{entry.body}</p>
                      ) : (
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{sentence}</p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>
        </aside>
      </div>

      <StatusSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChanged={() => void loadCard(true)}
      />
    </>
  );
}
