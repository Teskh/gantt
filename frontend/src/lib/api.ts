const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

export const apiUrl = (path: string) => `${API_BASE}${path}`;

const CLIENT_ID_STORAGE_KEY = "gantt:sync-client-id";
let cachedClientId: string | null = null;

const createClientId = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const getApiClientId = () => {
  if (cachedClientId) return cachedClientId;
  try {
    const existing = window.sessionStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (existing) {
      cachedClientId = existing;
      return existing;
    }
    const created = createClientId();
    window.sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, created);
    cachedClientId = created;
    return created;
  } catch {
    cachedClientId = createClientId();
    return cachedClientId;
  }
};

export const apiRequest = async (path: string, options?: RequestInit) => {
  const headers = new Headers(options?.headers);
  headers.set("X-Gantt-Client-Id", getApiClientId());
  const response = await fetch(apiUrl(path), {
    ...options,
    headers,
    cache: "no-store",
    credentials: "include",
  });
  if (response.status === 401) {
    window.dispatchEvent(new Event("gantt:unauthorized"));
  }
  return response;
};

export const apiFetch = async <T>(
  path: string,
  options?: RequestInit
): Promise<T> => {
  const response = await apiRequest(path, options);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json() as Promise<T>;
};

export type SyncEvent =
  | { type: "scenario"; scenarioId: number }
  | { type: "scenarios" }
  | { type: "settings" }
  | { type: "project-card"; baseProjectId: number }
  | { type: "status-catalog" };

export const SYNC_EVENT_NAME = "gantt:sync";

export const createSyncEventSource = () =>
  new EventSource(
    apiUrl(`/api/sync-events?clientId=${encodeURIComponent(getApiClientId())}`),
    { withCredentials: true }
  );
