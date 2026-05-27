import type { CodexModelOption, CodexReasoningEffort } from "../domain/sessionRuntimeConfigService.js";

export interface CodexModelListSnapshot {
  defaultModel: string | null;
  models: CodexModelOption[];
}

const DEFAULT_SUPPORTED_EFFORTS: CodexReasoningEffort[] = ["low", "medium", "high", "xhigh"];
const VALID_EFFORTS = new Set<CodexReasoningEffort>(["low", "medium", "high", "xhigh"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "true";
}

function effortFromValue(value: unknown): CodexReasoningEffort | null {
  if (typeof value === "string" && VALID_EFFORTS.has(value as CodexReasoningEffort)) {
    return value as CodexReasoningEffort;
  }
  const record = asRecord(value);
  const effort = optionalString(record.reasoningEffort ?? record.effort ?? record.id);
  if (effort !== null && VALID_EFFORTS.has(effort as CodexReasoningEffort)) {
    return effort as CodexReasoningEffort;
  }
  return null;
}

function supportedEfforts(value: unknown): CodexReasoningEffort[] {
  const efforts: CodexReasoningEffort[] = [];
  for (const entry of asArray(value)) {
    const effort = effortFromValue(entry);
    if (effort !== null && !efforts.includes(effort)) {
      efforts.push(effort);
    }
  }
  return efforts.length > 0 ? efforts : DEFAULT_SUPPORTED_EFFORTS;
}

export function mapCodexModelList(response: unknown): CodexModelListSnapshot {
  const record = asRecord(response);
  const modelInputs = asArray(record.models ?? record.data);
  let defaultModel = optionalString(record.defaultModel ?? record.default_model);
  const models: CodexModelOption[] = [];

  for (const input of modelInputs) {
    const model = asRecord(input);
    const id = optionalString(model.id ?? model.model);
    if (!id || booleanValue(model.hidden)) continue;
    const isDefault = booleanValue(model.isDefault ?? model.default) || defaultModel === id;
    if (isDefault && defaultModel === null) {
      defaultModel = id;
    }
    models.push({
      id,
      label: optionalString(model.label) ?? optionalString(model.displayName) ?? optionalString(model.name) ?? optionalString(model.model) ?? id,
      isDefault,
      hidden: false,
      isAvailable: true,
      supportedEfforts: supportedEfforts(
        model.supportedEfforts ?? model.supported_efforts ?? model.supportedReasoningEfforts ?? model.supported_reasoning_efforts
      )
    });
  }

  return {
    defaultModel,
    models
  };
}
