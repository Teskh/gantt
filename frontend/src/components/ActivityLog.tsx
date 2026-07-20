import { useEffect, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { apiFetch } from "@/lib/api";

export interface AuditLogEntry {
  id: number;
  occurredAt: string;
  actorEmail: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  scenarioId: number | null;
  scenarioName: string | null;
  summary: string;
  details: unknown;
}

interface ActivityLogProps {
  open: boolean;
  onClose: () => void;
}

interface ProductionRateChange {
  month: string;
  initialValue: number | null;
  newValue: number | null;
  initialActive: boolean;
  newActive: boolean;
}

interface ProductionRateState {
  month: string;
  rate: number;
  isActive: boolean;
}

const actionLabels: Record<string, string> = {
  "auth.login": "Ingreso",
  "scenario.create": "Escenario",
  "scenario.rename": "Escenario",
  "scenario.copy": "Escenario",
  "scenario.delete": "Escenario",
  "settings.range.update": "Configuración",
  "project.create": "Proyecto",
  "project.update": "Proyecto",
  "project.move": "Movimiento",
  "project.mute": "Proyecto",
  "project.delete": "Proyecto",
  "project.reorder": "Orden",
  "production_rate.update": "Capacidad",
  "status_definition.create": "Configuración",
  "status_definition.update": "Configuración",
  "status_definition.archive": "Configuración",
  "project.status.assign": "Seguimiento",
  "project.status.update": "Seguimiento",
  "project.status.unassign": "Seguimiento",
  "project.note.create": "Nota",
};

const readProductionRateChanges = (details: unknown): ProductionRateChange[] => {
  if (!details || typeof details !== "object") return [];
  const payload = details as { changes?: unknown; before?: unknown; after?: unknown };
  if (Array.isArray(payload.changes)) {
    return payload.changes.filter((change): change is ProductionRateChange =>
      Boolean(change) &&
      typeof change === "object" &&
      typeof (change as ProductionRateChange).month === "string" &&
      ((change as ProductionRateChange).initialValue === null || typeof (change as ProductionRateChange).initialValue === "number") &&
      ((change as ProductionRateChange).newValue === null || typeof (change as ProductionRateChange).newValue === "number") &&
      typeof (change as ProductionRateChange).initialActive === "boolean" &&
      typeof (change as ProductionRateChange).newActive === "boolean"
    );
  }

  const readStates = (value: unknown): ProductionRateState[] =>
    Array.isArray(value)
      ? value.filter((point): point is ProductionRateState =>
        Boolean(point) &&
        typeof point === "object" &&
        typeof (point as ProductionRateState).month === "string" &&
        typeof (point as ProductionRateState).rate === "number" &&
        typeof (point as ProductionRateState).isActive === "boolean"
      )
      : [];
  const beforeByMonth = new Map(readStates(payload.before).map((point) => [point.month, point]));
  const afterByMonth = new Map(readStates(payload.after).map((point) => [point.month, point]));
  return [...new Set([...beforeByMonth.keys(), ...afterByMonth.keys()])]
    .sort()
    .flatMap((month) => {
      const before = beforeByMonth.get(month);
      const after = afterByMonth.get(month);
      const initialActive = before?.isActive ?? false;
      const newActive = after?.isActive ?? false;
      if (!initialActive && !newActive) return [];
      if (before?.rate === after?.rate && initialActive === newActive) return [];
      return [{
        month,
        initialValue: before?.rate ?? null,
        newValue: after?.rate ?? null,
        initialActive,
        newActive,
      }];
    });
};

const formatMonth = (value: string) => {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Date(year, month - 1, 1).toLocaleDateString("es-CL", {
    month: "long",
    year: "numeric",
  });
};

const formatRate = (value: number | null) =>
  value === null
    ? "Sin valor"
    : new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(value);

export function ActivityLog({ open, onClose }: ActivityLogProps) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    apiFetch<AuditLogEntry[]>("/api/audit-logs?limit=150")
      .then(setEntries)
      .catch(() => setError("No se pudo cargar la actividad."))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/40" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-title"
        className="flex h-full w-full max-w-2xl flex-col border-l border-border bg-background"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex min-h-14 items-center justify-between border-b border-border px-4 py-2.5">
          <div>
            <h2 id="activity-title" className="text-sm font-bold uppercase tracking-wide">Actividad reciente</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Ingresos, vistas y cambios guardados</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {loading && <p className="px-4 py-5 text-xs text-muted-foreground">Cargando actividad...</p>}
          {error && <p className="px-4 py-5 text-xs text-red-600">{error}</p>}
          {!loading && !error && entries.length === 0 && (
            <p className="px-4 py-5 text-xs text-muted-foreground">Todavia no hay actividad registrada.</p>
          )}
          <ol>
            {entries.map((entry) => {
              const rateChanges = entry.action === "production_rate.update"
                ? readProductionRateChanges(entry.details)
                : [];
              return (
                <li key={entry.id} className="grid grid-cols-[88px_minmax(0,1fr)] border-b border-border hover:bg-muted/30">
                  <div className="border-r border-border px-3 py-3">
                    <span className="block break-words text-[9px] font-bold uppercase tracking-[0.12em] text-amber-700 dark:text-amber-500">
                      {actionLabels[entry.action] ?? entry.entityType}
                    </span>
                    <time className="mt-1.5 block text-[9px] leading-4 tabular-nums text-muted-foreground">
                      {new Date(entry.occurredAt).toLocaleString("es-CL")}
                    </time>
                  </div>
                  <div className="min-w-0 px-3 py-2.5">
                    <p className="text-xs font-medium leading-5 text-foreground">{entry.summary}</p>
                    {rateChanges.length > 0 && (
                      <div className="mt-2 border border-border bg-background">
                        {rateChanges.map((change, index) => (
                          <div
                            key={change.month}
                            className={`grid grid-cols-[minmax(90px,0.8fr)_minmax(0,1.4fr)] gap-x-3 px-2.5 py-1.5 ${index > 0 ? "border-t border-border" : ""}`}
                          >
                            <div className="text-[10px] font-semibold capitalize leading-4 text-foreground">
                              {formatMonth(change.month)}
                            </div>
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] tabular-nums text-foreground">
                              <span className="text-muted-foreground">Inicial</span>
                              <span>{formatRate(change.initialValue)}</span>
                              <ArrowRight className="h-3 w-3 shrink-0 text-amber-600" />
                              <span className="text-muted-foreground">Nuevo</span>
                              <span>{formatRate(change.newValue)}</span>
                            </div>
                            {change.initialActive !== change.newActive && (
                              <div className="col-span-2 mt-1 flex items-center gap-1.5 text-[9px] text-muted-foreground">
                                <span>{change.initialActive ? "Activa" : "Inactiva"}</span>
                                <ArrowRight className="h-2.5 w-2.5 text-amber-600" />
                                <span>{change.newActive ? "Activa" : "Inactiva"}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] leading-4 text-muted-foreground">
                      <span title={entry.actorEmail}>{entry.actorName || entry.actorEmail}</span>
                      {entry.actorName && <span>{entry.actorEmail}</span>}
                      {entry.scenarioName && <span>Escenario: {entry.scenarioName}</span>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </aside>
    </div>
  );
}
