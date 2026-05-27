const CONTEXTUAL_MARKER_PAIRS: Array<[string, string]> = [
  ["<environment_context>", "</environment_context>"],
  ["<turn_aborted>", "</turn_aborted>"],
  ["<subagent_notification>", "</subagent_notification>"],
  ["<skill>", "</skill>"],
  ["<user_shell_command>", "</user_shell_command>"],
  ["<goal_context>", "</goal_context>"],
  ["<legacy_unified_exec_process_limit_warning>", "</legacy_unified_exec_process_limit_warning>"],
  ["<legacy_apply_patch_exec_command_warning>", "</legacy_apply_patch_exec_command_warning>"],
  ["<legacy_model_mismatch_warning>", "</legacy_model_mismatch_warning>"]
];

const LEGACY_IDE_REQUEST_MARKER = "## My request for Codex:";

export interface HookPromptFragment {
  text: string;
  hookRunId: string;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function parseVisibleHookPromptText(text: string): HookPromptFragment | null {
  const trimmed = text.trim();
  const match = /^<hook_prompt\s+hook_run_id="([^"]+)"\s*>([\s\S]*)<\/hook_prompt>$/.exec(trimmed);
  if (!match) return null;
  const hookRunId = match[1].trim();
  if (hookRunId.length === 0) return null;
  return {
    text: decodeXmlText(match[2]),
    hookRunId
  };
}

export function isOfficialContextualUserText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (parseVisibleHookPromptText(trimmed) !== null) return true;
  if (trimmed.startsWith("# AGENTS.md instructions")) return true;
  if (trimmed.includes("<INSTRUCTIONS>")) return true;
  if (trimmed.startsWith("# Context from my IDE setup:") && !trimmed.includes(LEGACY_IDE_REQUEST_MARKER)) return true;
  for (const [start, end] of CONTEXTUAL_MARKER_PAIRS) {
    if (trimmed.startsWith(start) && trimmed.endsWith(end)) return true;
  }
  return false;
}

export function visibleUserTextFromLegacyIdePayload(text: string): string | null {
  const markerIndex = text.indexOf(LEGACY_IDE_REQUEST_MARKER);
  if (markerIndex < 0) return null;
  if (!text.trimStart().startsWith("# Context from my IDE setup:")) return null;
  const visibleText = text.slice(markerIndex + LEGACY_IDE_REQUEST_MARKER.length).trim();
  return visibleText.length > 0 ? visibleText : null;
}
