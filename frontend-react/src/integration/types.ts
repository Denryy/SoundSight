// Типы контракта интеграции с бэкендом SoundSight (ТЗ §6.2, §6.4).
// Эти типы фиксированы контрактом — менять только вслед за бэкендом.

import type { PoseTrack } from "../avatar3d/poseTypes";

export type LangMode = "auto" | "ru" | "en" | "kz";

// ── REST (§6.2) ─────────────────────────────────────────────────────────────

export interface SessionStartResponse {
  session_id: string;
  status: "started" | "already_running";
}

export interface SessionStopResponse {
  session_id: string;
  status: "stopped" | "no_active_session";
}

export interface ModeResponse {
  mode: LangMode;
}

export interface SessionStatusResponse {
  active: boolean;
  session_id?: string;
  transcript_chunks?: number;
}

export interface SummaryResponse {
  session_id: string;
  summary: string;
  transcript_preview: string;
}

export interface LiveSummaryResponse {
  text: string;
  active: boolean;
  chunks: number;
}

export interface SessionMeta {
  session_id: string;
  title: string;
  started_at: string;
  ended_at: string | null;
  summary: string;
  chunks: number;
}

export interface SessionListResponse {
  sessions: SessionMeta[];
}

export interface AvatarPreviewResponse {
  text: string;
  translated_en: string;
  sigml: string;
  has_sign: boolean;
  duration_ms: number;
  /** Pose-track собственного 3D-аватара (может отсутствовать у старого бэкенда). */
  pose?: PoseTrack | null;
}

export interface HealthResponse {
  status: string;
}

// ── WebSocket: сообщения сервера (§6.4) ──────────────────────────────────────

export interface SubtitleInterimMessage {
  type: "subtitle_interim";
  text: string;
  timestamp: number;
}

export interface AgentMeta {
  importance: number;
  refresh_summary: boolean;
  reason: string;
}

export interface SubtitleFinalMessage {
  type: "subtitle";
  text: string;
  keywords: string[];
  avatar_url: string | null;
  avatar_sigml: string | null;
  /** Pose-track для собственного 3D-аватара (null — нечего показывать). */
  avatar_pose: PoseTrack | null;
  avatar_duration_ms: number;
  timestamp: number;
  agent?: AgentMeta;
}

export type ServerMessage = SubtitleInterimMessage | SubtitleFinalMessage;
