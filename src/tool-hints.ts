export interface ToolHint {
  name: string
  envVar: string
}

export const WELL_KNOWN_TOOL_HINTS: ToolHint[] = [
  { name: 'Claude Code', envVar: 'ANTHROPIC_BASE_URL' },
  { name: 'Aider', envVar: 'OPENAI_API_BASE' },
  { name: 'Continue.dev', envVar: 'OPENAI_BASE_URL' },
  { name: 'Codex', envVar: 'OPENAI_BASE_URL' },
]

export function formatToolHints(hints: ToolHint[], proxyUrl: string): string[] {
  return hints.map(hint => `export ${hint.envVar}=${proxyUrl}   # ${hint.name}`)
}
