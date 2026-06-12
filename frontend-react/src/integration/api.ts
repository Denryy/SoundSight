// REST-клиент контракта SoundSight (ТЗ §6.2). Базовый URL относительный — тот же origin.
import type {
  AvatarPreviewResponse,
  HealthResponse,
  LangMode,
  LiveSummaryResponse,
  ModeResponse,
  SessionListResponse,
  SessionStartResponse,
  SessionStatusResponse,
  SessionStopResponse,
  SummaryResponse,
} from "./types";

const API = ""; // тот же origin; в dev проксируется Vite (см. vite.config.ts)

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new ApiError(res.status, path);
  return (await res.json()) as T;
}

async function postJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, path);
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public path: string,
  ) {
    super(`API ${status} @ ${path}`);
    this.name = "ApiError";
  }
}

export const api = {
  startSession: () => postJSON<SessionStartResponse>("/session/start"),
  stopSession: () => postJSON<SessionStopResponse>("/session/stop"),

  setMode: (mode: LangMode) => postJSON<ModeResponse>(`/session/mode/${mode}`),
  getMode: () => getJSON<ModeResponse>("/session/mode"),

  getStatus: () => getJSON<SessionStatusResponse>("/session/status"),

  getSummary: (sessionId: string) =>
    getJSON<SummaryResponse>(`/summary/${sessionId}`),
  getLiveSummary: () => getJSON<LiveSummaryResponse>("/summary/current/live"),

  getSessions: () => getJSON<SessionListResponse>("/sessions"),

  avatarPreview: (text: string) =>
    getJSON<AvatarPreviewResponse>(
      `/avatar/preview?text=${encodeURIComponent(text)}`,
    ),

  health: () => getJSON<HealthResponse>("/health"),
};
