import {
  isOfficialContextualUserText,
  parseVisibleHookPromptText,
  visibleUserTextFromLegacyIdePayload,
  type HookPromptFragment
} from "./codexContextualUserFragments.js";
import { stripMobileInputGuidance } from "../domain/inputGuidance.js";

export type ClassifiedTimelineKind =
  | "userMessage"
  | "hookPrompt"
  | "agentMessage"
  | "reasoning"
  | "plan"
  | "commandExecution"
  | "fileChange"
  | "mcpToolCall"
  | "dynamicToolCall"
  | "collabAgentToolCall"
  | "webSearch"
  | "imageView"
  | "imageGeneration"
  | "reviewStatus"
  | "contextCompaction"
  | "diffOverview"
  | "approval"
  | "processedSummary"
  | "artifact"
  | "error"
  | "toolProgress";

export interface ClassifiedThreadItem {
  kind: ClassifiedTimelineKind;
  visibleText: string | null;
  rawText: string;
  hookFragments: HookPromptFragment[];
  isLegacyAssistantFallback: boolean;
  isLegacyUserWrapper: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function textFromContentArray(content: unknown): string {
  return asArray(content)
    .map((entry) => stringOrNull(asRecord(entry).text) ?? "")
    .filter((text) => text.length > 0)
    .join("\n");
}

function textFromStringArray(content: unknown): string {
  return asArray(content)
    .map((entry) => typeof entry === "string" ? entry : "")
    .filter((text) => text.length > 0)
    .join("\n");
}

function textFromErrorValue(error: unknown): string {
  const directText = stringOrNull(error);
  if (directText !== null) return directText;

  const record = asRecord(error);
  const message = stringOrNull(record.message);
  if (message !== null) return message;

  const detail = stringOrNull(record.detail);
  if (detail !== null) return detail;

  const reason = stringOrNull(record.reason);
  if (reason !== null) return reason;

  return "";
}

export function textFromCodexThreadItem(item: Record<string, unknown>): string {
  const directText = stringOrNull(item.text);
  if (directText !== null) return directText;

  const messageText = stringOrNull(item.message);
  if (messageText !== null) return messageText;

  const summaryText = stringOrNull(item.summary);
  if (summaryText !== null) return summaryText;

  const summaryArrayText = textFromStringArray(item.summary_text);
  if (summaryArrayText.length > 0) return summaryArrayText;

  const summaryTextArrayText = textFromStringArray(item.summaryText);
  if (summaryTextArrayText.length > 0) return summaryTextArrayText;

  const contentTextField = stringOrNull(item.contentText);
  if (contentTextField !== null) return contentTextField;

  const contentText = textFromContentArray(item.content);
  if (contentText.length > 0) return contentText;

  const summaryArray = textFromStringArray(item.summary);
  if (summaryArray.length > 0) return summaryArray;

  const contentArray = textFromStringArray(item.content);
  if (contentArray.length > 0) return contentArray;

  const outputText = stringOrNull(item.output);
  if (outputText !== null) return outputText;

  const aggregatedOutputText = stringOrNull(item.aggregatedOutput);
  if (aggregatedOutputText !== null) return aggregatedOutputText;

  const errorText = textFromErrorValue(item.error);
  if (errorText.length > 0) return errorText;

  const failureText = textFromErrorValue(item.failure);
  if (failureText.length > 0) return failureText;

  return "";
}

function classifyOfficialType(type: string): ClassifiedTimelineKind | null {
  if (type === "userMessage") return "userMessage";
  if (type === "hookPrompt") return "hookPrompt";
  if (type === "agentMessage") return "agentMessage";
  if (type === "reasoning" || type === "reasoningSummary") return "reasoning";
  if (type === "plan") return "plan";
  if (type === "commandExecution") return "commandExecution";
  if (type === "fileChange") return "fileChange";
  if (type === "mcpToolCall") return "mcpToolCall";
  if (type === "dynamicToolCall") return "dynamicToolCall";
  if (type === "collabAgentToolCall") return "collabAgentToolCall";
  if (type === "webSearch") return "webSearch";
  if (type === "imageView") return "imageView";
  if (type === "imageGeneration") return "imageGeneration";
  if (type === "enteredReviewMode" || type === "exitedReviewMode" || type === "reviewStatus") return "reviewStatus";
  if (type === "contextCompaction") return "contextCompaction";
  if (type === "diffOverview") return "diffOverview";
  if (type === "approval") return "approval";
  if (type === "processedSummary") return "processedSummary";
  if (type === "artifact") return "artifact";
  if (type === "error") return "error";
  if (type === "toolProgress") return "toolProgress";
  return null;
}

function hookFragmentsFromResponseMessage(content: unknown): HookPromptFragment[] | null {
  const fragments: HookPromptFragment[] = [];
  for (const contentItem of asArray(content)) {
    const text = stringOrNull(asRecord(contentItem).text);
    if (!text) return null;
    const hookFragment = parseVisibleHookPromptText(text);
    if (hookFragment) {
      fragments.push(hookFragment);
      continue;
    }
    if (isOfficialContextualUserText(text)) continue;
    return null;
  }
  return fragments.length > 0 ? fragments : null;
}

export function classifyCodexThreadItem(itemInput: unknown): ClassifiedThreadItem | null {
  const item = asRecord(itemInput);
  const type = stringOrNull(item.type);
  const role = stringOrNull(item.role);
  const rawText = textFromCodexThreadItem(item);

  if (type === "message") {
    if (role === "user") {
      const hookFragments = hookFragmentsFromResponseMessage(item.content);
      if (hookFragments) {
        return {
          kind: "hookPrompt",
          visibleText: hookFragments.map((fragment) => fragment.text).join("\n"),
          rawText,
          hookFragments,
          isLegacyAssistantFallback: false,
          isLegacyUserWrapper: false
        };
      }
      const legacyVisibleText = visibleUserTextFromLegacyIdePayload(rawText);
      if (legacyVisibleText !== null) {
        return {
          kind: "userMessage",
          visibleText: legacyVisibleText,
          rawText,
          hookFragments: [],
          isLegacyAssistantFallback: false,
          isLegacyUserWrapper: true
        };
      }
      return null;
    }
    if (role === "assistant") {
      const visibleText = rawText.trim();
      if (visibleText.length === 0) return null;
      return {
        kind: "agentMessage",
        visibleText,
        rawText,
        hookFragments: [],
        isLegacyAssistantFallback: true,
        isLegacyUserWrapper: false
      };
    }
    return null;
  }

  if (!type) return null;
  const kind = classifyOfficialType(type);
  if (!kind) return null;
  const visibleRawText = kind === "userMessage" ? stripMobileInputGuidance(rawText) : rawText;
  if (kind === "userMessage" && isOfficialContextualUserText(visibleRawText)) return null;
  const hookFragments = kind === "hookPrompt" ? asArray(item.fragments)
    .map((fragment) => {
      const record = asRecord(fragment);
      const text = stringOrNull(record.text);
      const hookRunId = stringOrNull(record.hookRunId ?? record.hook_run_id);
      return text && hookRunId ? { text, hookRunId } : null;
    })
    .filter((fragment): fragment is HookPromptFragment => fragment !== null) : [];

  return {
    kind,
    visibleText: visibleRawText.trim().length > 0 ? visibleRawText.trim() : null,
    rawText: kind === "userMessage" ? visibleRawText : rawText,
    hookFragments,
    isLegacyAssistantFallback: false,
    isLegacyUserWrapper: false
  };
}
