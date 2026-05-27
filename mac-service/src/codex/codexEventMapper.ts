export type SessionPlanStepStatus = "pending" | "in_progress" | "completed" | "failed";

export interface SessionPlanStep {
  id: string;
  title: string;
  status: SessionPlanStepStatus;
  detail: string;
}

export function normalizePlanStepStatus(value: unknown): SessionPlanStepStatus {
  if (typeof value !== "string") return "pending";
  const status = value.trim().replace(/-/g, "_").toLowerCase();
  if (status === "completed" || status === "complete" || status === "done" || status === "success" || status === "succeeded") {
    return "completed";
  }
  if (status === "in_progress" || status === "inprogress" || status === "running" || status === "started" || status === "active") {
    return "in_progress";
  }
  if (status === "failed" || status === "failure" || status === "error" || status === "errored") {
    return "failed";
  }
  return "pending";
}

export interface CommandSummary {
  id: string;
  turnId: string;
  title: string;
  command: string;
  status: "running" | "completed" | "failed";
  exitCode: number | null;
  summaryLines: string[];
  rawOutput: string;
}

export interface DiffFileOverview {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  insertions: number;
  deletions: number;
  patch: string;
}

export interface DiffOverview {
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: DiffFileOverview[];
}

export type ServerEvent =
  | { type: "session.plan.updated"; sessionId: string; steps: SessionPlanStep[] }
  | { type: "session.commandSummary.updated"; sessionId: string; command: CommandSummary }
  | { type: "session.diffOverview.updated"; sessionId: string; diff: DiffOverview };

export function mapPlanUpdate(sessionId: string, steps: Array<{ id: string; title: string; status: unknown; detail?: string }>): ServerEvent {
  return {
    type: "session.plan.updated",
    sessionId,
    steps: steps.map((step) => ({
      id: step.id,
      title: step.title,
      status: normalizePlanStepStatus(step.status),
      detail: step.detail ?? ""
    }))
  };
}

export function mapCommandOutput(sessionId: string, turnId: string, command: string, output: string): ServerEvent {
  const summary: CommandSummary = {
    id: `${turnId}:command`,
    turnId,
    title: command.split(/\s+/).filter(Boolean).slice(0, 3).join(" ") || "command",
    command,
    status: "completed",
    exitCode: 0,
    summaryLines: output.split("\n").filter(Boolean).slice(-6),
    rawOutput: output
  };
  return { type: "session.commandSummary.updated", sessionId, command: summary };
}

export function mapDiffUpdate(sessionId: string, files: Array<Omit<DiffFileOverview, "patch"> & { patch?: string }>): ServerEvent {
  const normalizedFiles: DiffFileOverview[] = files.map((file) => ({
    path: file.path,
    status: file.status,
    insertions: file.insertions,
    deletions: file.deletions,
    patch: file.patch ?? ""
  }));
  return {
    type: "session.diffOverview.updated",
    sessionId,
    diff: {
      filesChanged: normalizedFiles.length,
      insertions: normalizedFiles.reduce((sum, file) => sum + file.insertions, 0),
      deletions: normalizedFiles.reduce((sum, file) => sum + file.deletions, 0),
      files: normalizedFiles
    }
  };
}
