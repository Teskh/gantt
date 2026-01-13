const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

export const apiUrl = (path: string) => `${API_BASE}${path}`;

export const apiFetch = async <T>(
  path: string,
  options?: RequestInit
): Promise<T> => {
  const response = await fetch(apiUrl(path), options);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json() as Promise<T>;
};
