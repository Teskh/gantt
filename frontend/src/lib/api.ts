const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

export const apiUrl = (path: string) => `${API_BASE}${path}`;

export const apiRequest = async (path: string, options?: RequestInit) => {
  const response = await fetch(apiUrl(path), {
    ...options,
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
