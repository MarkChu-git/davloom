import type { BackendStatus } from "../sample-data/data";
import type { Tone } from "../shell/StatusLabel";

export const BACKEND_STATUS: Record<BackendStatus, { tone: Tone; label: string }> = {
  connected: { tone: "success", label: "Connected" },
  degraded: { tone: "warning", label: "Slow" },
  unreachable: { tone: "error", label: "Unreachable" },
};
