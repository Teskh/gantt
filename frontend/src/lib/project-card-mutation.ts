import type { ProjectCardData } from "./project-tracking";

export interface ProjectCardMutationPayload {
  error?: string;
  card?: ProjectCardData;
  [key: string]: unknown;
}

export const readProjectCardMutation = async (
  response: Response,
  fallbackMessage: string
): Promise<ProjectCardMutationPayload> => {
  const payload = await response.json().catch(() => ({})) as ProjectCardMutationPayload;
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : fallbackMessage);
  }
  return payload;
};
