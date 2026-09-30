import { useEffect, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { apiFetch, apiRequest } from "@/lib/api";

interface ManagedUser {
  email: string;
  displayName: string;
  canEdit: boolean;
  isAdmin: boolean;
  lastLoginAt: string | null;
}

interface UserPermissionsDialogProps {
  open: boolean;
  onClose: () => void;
}

const formatLastLogin = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" })
    : "Nunca ha ingresado";

export function UserPermissionsDialog({ open, onClose }: UserPermissionsDialogProps) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingEmail, setSavingEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    apiFetch<ManagedUser[]>("/api/admin/users")
      .then(setUsers)
      .catch(() => setError("No se pudo cargar la lista de usuarios."))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const setCanEdit = async (user: ManagedUser, canEdit: boolean) => {
    setSavingEmail(user.email);
    setError(null);
    try {
      const response = await apiRequest(`/api/admin/users/${encodeURIComponent(user.email)}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canEdit }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "No se pudo cambiar el permiso.");
      setUsers((current) => current.map((item) => item.email === user.email ? payload : item));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo cambiar el permiso.");
    } finally {
      setSavingEmail(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/40" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="users-title"
        className="flex h-full w-full max-w-lg flex-col border-l border-border bg-background"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex min-h-14 items-center justify-between border-b border-border px-4 py-2.5">
          <div>
            <h2 id="users-title" className="text-sm font-bold uppercase tracking-wide">Usuarios y permisos</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Los lectores ven la planificación y cambian el rango solo en su vista.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {loading && <p className="px-4 py-5 text-xs text-muted-foreground">Cargando usuarios...</p>}
          {error && <p role="alert" className="border-b border-border px-4 py-3 text-xs text-red-600">{error}</p>}
          {!loading && users.length === 0 && !error && (
            <p className="px-4 py-5 text-xs text-muted-foreground">
              Todavía no hay usuarios. Aparecen aquí después de su primer ingreso.
            </p>
          )}
          <ul>
            {users.map((user) => (
              <li key={user.email} className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{user.displayName}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{user.email}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{formatLastLogin(user.lastLoginAt)}</p>
                </div>
                {user.isAdmin ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Administrador
                  </span>
                ) : (
                  <div
                    role="radiogroup"
                    aria-label={`Permiso de ${user.displayName}`}
                    className="inline-flex shrink-0 border border-border text-[10px] font-bold uppercase"
                  >
                    {[
                      { value: false, label: "Lector" },
                      { value: true, label: "Editor" },
                    ].map((option) => (
                      <button
                        key={option.label}
                        type="button"
                        role="radio"
                        aria-checked={user.canEdit === option.value}
                        disabled={savingEmail === user.email}
                        onClick={() => { if (user.canEdit !== option.value) void setCanEdit(user, option.value); }}
                        className={`px-3 py-1.5 tracking-wide transition-colors disabled:opacity-50 ${
                          user.canEdit === option.value
                            ? "bg-amber-500 text-amber-950"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
