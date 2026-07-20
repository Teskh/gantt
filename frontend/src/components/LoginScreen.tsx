import { useEffect, useState } from "react";
import { apiFetch, apiUrl } from "@/lib/api";
import { ThemeProvider } from "./theme-provider";

interface AuthConfig {
  microsoftConfigured: boolean;
}

export function LoginScreen() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const authError = new URLSearchParams(window.location.search).get("auth_error");

  useEffect(() => {
    apiFetch<AuthConfig>("/api/auth/config")
      .then((config) => setConfigured(config.microsoftConfigured))
      .catch(() => setConfigured(false));
  }, []);

  return (
    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
      <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
        <section className="w-full max-w-md border border-border bg-card p-8 shadow-lg">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-600">
            Planificacion
          </p>
          <h1 className="mt-3 text-2xl font-bold">Gantt de produccion</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ingresa con tu cuenta Microsoft de Grupo Patagual.
          </p>

          {authError && (
            <div className="mt-6 border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {authError}
            </div>
          )}

          {configured === false && (
            <div className="mt-6 border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              El ingreso Microsoft todavia no esta configurado en el servidor.
            </div>
          )}

          <button
            type="button"
            disabled={configured !== true}
            onClick={() => window.location.assign(apiUrl("/api/auth/microsoft/login"))}
            className="mt-6 flex h-11 w-full items-center justify-center gap-3 bg-[#2f2f2f] px-4 text-sm font-semibold text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="grid grid-cols-2 gap-0.5" aria-hidden="true">
              <span className="h-2.5 w-2.5 bg-[#f35325]" />
              <span className="h-2.5 w-2.5 bg-[#81bc06]" />
              <span className="h-2.5 w-2.5 bg-[#05a6f0]" />
              <span className="h-2.5 w-2.5 bg-[#ffba08]" />
            </span>
            Iniciar sesion con Microsoft
          </button>
        </section>
      </main>
    </ThemeProvider>
  );
}
