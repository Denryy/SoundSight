// Запись живого зеркала в клип датасета: копит поток поз, которые аватар
// повторял, и на стопе отдаёт прореженный клип в контракте поз — ровно то, что
// принимает бэкенд POST /avatar/dataset/clip и формат ml/extract_pose_clip.py.

import { thinKeyframes, type RetargetFrame } from "../avatar3d/poseRetarget";
import type { Pose } from "../avatar3d/poseTypes";

export interface RecordedClip {
  frames: Array<{ t: number; pose: Pose }>;
  hold: number;
}

export class PoseRecorder {
  private frames: RetargetFrame[] = [];
  private t0 = 0;
  private recording = false;

  start(nowMs: number): void {
    this.frames = [];
    this.t0 = nowMs;
    this.recording = true;
  }

  isRecording(): boolean {
    return this.recording;
  }

  /** Добавить кадр (no-op, если не идёт запись). */
  push(pose: Pose, nowMs: number): void {
    if (this.recording) this.frames.push({ t: Math.round(nowMs - this.t0), pose });
  }

  /** Завершить → прореженный клип, или null если кадров слишком мало. */
  stop(hold = 220, minDelta = 4): RecordedClip | null {
    this.recording = false;
    if (this.frames.length < 2) return null;
    const frames = thinKeyframes(this.frames, minDelta).map((f) => ({ t: f.t, pose: f.pose }));
    return { frames, hold };
  }
}
