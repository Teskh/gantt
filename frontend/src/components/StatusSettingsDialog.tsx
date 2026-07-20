import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Save, Settings2, Trash2, X } from "lucide-react";
import { apiFetch, apiRequest } from "@/lib/api";
import type { StatusDefinition } from "@/lib/project-tracking";

interface StatusSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

interface DraftOption {
  id?: number;
  label: string;
}

interface DefinitionDraft {
  id?: number;
  name: string;
  options: DraftOption[];
}

const readError = async (response: Response, fallback: string) => {
  const payload = await response.json().catch(() => ({}));
  return typeof payload.error === "string" ? payload.error : fallback;
};

export function StatusSettingsDialog({ open, onClose, onChanged }: StatusSettingsDialogProps) {
  const [definitions, setDefinitions] = useState<StatusDefinition[]>([]);
  const [draft, setDraft] = useState<DefinitionDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDefinitions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDefinitions(await apiFetch<StatusDefinition[]>("/api/status-definitions"));
    } catch {
      setError("No se pudo cargar la configuración de estados.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setDraft(null);
    void loadDefinitions();
  }, [open, loadDefinitions]);

  if (!open) return null;

  const editDefinition = (definition: StatusDefinition) => {
    setError(null);
    setDraft({
      id: definition.id,
      name: definition.name,
      options: definition.options.map((option) => ({ id: option.id, label: option.label })),
    });
  };

  const saveDraft = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    const options = draft.options
      .map((option) => ({ ...option, label: option.label.trim() }))
      .filter((option) => option.label);
    if (!name || options.length === 0) {
      setError("Escribe un nombre y al menos una alternativa.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await apiRequest(
        draft.id ? `/api/status-definitions/${draft.id}` : "/api/status-definitions",
        {
          method: draft.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, options }),
        }
      );
      if (!response.ok) throw new Error(await readError(response, "No se pudo guardar el estado."));
      await loadDefinitions();
      setDraft(null);
      onChanged();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar el estado.");
    } finally {
      setSaving(false);
    }
  };

  const archiveDefinition = async (definition: StatusDefinition) => {
    if (!window.confirm(`¿Eliminar el estado “${definition.name}”? El historial existente se conservará.`)) return;
    setError(null);
    try {
      const response = await apiRequest(`/api/status-definitions/${definition.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readError(response, "No se pudo eliminar el estado."));
      if (draft?.id === definition.id) setDraft(null);
      await loadDefinitions();
      onChanged();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "No se pudo eliminar el estado.");
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="status-settings-title"
        className="flex h-[min(720px,92vh)] w-full max-w-4xl flex-col border border-border bg-background"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
          <div className="flex items-center gap-3">
            <Settings2 className="h-4 w-4 text-amber-600" />
            <div>
              <h2 id="status-settings-title" className="text-sm font-bold uppercase tracking-wide">
                Estados del proyecto
              </h2>
              <p className="text-xs text-muted-foreground">Define campos y sus alternativas disponibles.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[300px,1fr]">
          <aside className="min-h-0 overflow-y-auto border-b border-border md:border-b-0 md:border-r">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Catálogo</span>
              <button
                type="button"
                onClick={() => setDraft({ name: "", options: [{ label: "" }] })}
                className="inline-flex h-8 items-center gap-1 border border-border px-2 text-xs font-semibold hover:border-amber-500 hover:text-amber-700"
              >
                <Plus className="h-3.5 w-3.5" />
                Nuevo
              </button>
            </div>
            {loading && <p className="p-4 text-xs text-muted-foreground">Cargando estados...</p>}
            {!loading && definitions.length === 0 && (
              <p className="p-4 text-xs leading-5 text-muted-foreground">Todavía no hay estados configurados.</p>
            )}
            <ul>
              {definitions.map((definition) => (
                <li key={definition.id} className="border-b border-border">
                  <button
                    type="button"
                    onClick={() => editDefinition(definition)}
                    className={`flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/70 ${draft?.id === definition.id ? "bg-amber-500/10" : ""}`}
                  >
                    <span>
                      <span className="block text-sm font-semibold">{definition.name}</span>
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        {definition.options.length} {definition.options.length === 1 ? "alternativa" : "alternativas"}
                      </span>
                    </span>
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <main className="min-h-0 overflow-y-auto p-5">
            {!draft ? (
              <div className="flex h-full min-h-48 items-center justify-center border border-dashed border-border text-center">
                <p className="max-w-xs text-xs leading-5 text-muted-foreground">
                  Selecciona un estado para editarlo o crea uno nuevo.
                </p>
              </div>
            ) : (
              <div className="mx-auto max-w-xl">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <h3 className="text-sm font-bold">{draft.id ? "Editar estado" : "Nuevo estado"}</h3>
                  {draft.id && (
                    <button
                      type="button"
                      onClick={() => {
                        const definition = definitions.find((item) => item.id === draft.id);
                        if (definition) void archiveDefinition(definition);
                      }}
                      className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Eliminar
                    </button>
                  )}
                </div>

                <label className="mt-5 block text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Nombre
                  <input
                    autoFocus
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    placeholder="Ej. Contrato"
                    className="mt-2 h-10 w-full border border-border bg-background px-3 text-sm normal-case tracking-normal text-foreground outline-none focus:border-amber-500"
                  />
                </label>

                <div className="mt-6">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Alternativas</span>
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, options: [...draft.options, { label: "" }] })}
                      className="inline-flex items-center gap-1 text-xs font-semibold hover:text-amber-700"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Agregar alternativa
                    </button>
                  </div>
                  <div className="mt-2 space-y-2">
                    {draft.options.map((option, index) => (
                      <div key={option.id ?? `new-${index}`} className="flex items-center gap-2">
                        <span className="w-6 text-right text-[10px] tabular-nums text-muted-foreground">{index + 1}</span>
                        <input
                          value={option.label}
                          onChange={(event) => {
                            const options = draft.options.map((item, optionIndex) =>
                              optionIndex === index ? { ...item, label: event.target.value } : item
                            );
                            setDraft({ ...draft, options });
                          }}
                          placeholder="Nombre de la alternativa"
                          className="h-9 flex-1 border border-border bg-background px-3 text-sm outline-none focus:border-amber-500"
                        />
                        <button
                          type="button"
                          onClick={() => setDraft({ ...draft, options: draft.options.filter((_, optionIndex) => optionIndex !== index) })}
                          className="p-2 text-muted-foreground hover:text-red-600"
                          aria-label="Quitar alternativa"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {error && <p role="alert" className="mt-4 border-l-2 border-red-500 pl-3 text-xs text-red-600">{error}</p>}

                <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
                  <button type="button" onClick={() => setDraft(null)} className="h-9 border border-border px-4 text-xs font-semibold hover:bg-muted">
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveDraft()}
                    disabled={saving}
                    className="inline-flex h-9 items-center gap-2 border border-amber-600 bg-amber-600 px-4 text-xs font-bold text-slate-950 hover:bg-amber-500 disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {saving ? "Guardando..." : "Guardar"}
                  </button>
                </div>
              </div>
            )}
            {!draft && error && <p role="alert" className="mt-4 text-xs text-red-600">{error}</p>}
          </main>
        </div>
      </section>
    </div>
  );
}
