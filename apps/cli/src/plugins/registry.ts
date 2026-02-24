export interface TrustedPlugin {
  name: string
  type: 'provider' | 'router'
  description: string
  package: string
}

export const TRUSTED_PLUGINS: TrustedPlugin[] = [
  {
    name: 'anthropic',
    type: 'provider',
    description: 'Sell Anthropic API capacity (API key)',
    package: '@antseed/provider-anthropic',
  },
  {
    name: 'claude-code',
    type: 'provider',
    description: 'Sell Claude capacity via Claude Code keychain',
    package: '@antseed/provider-claude-code',
  },
  {
    name: 'openrouter',
    type: 'provider',
    description: 'Sell via OpenRouter (multi-model)',
    package: '@antseed/provider-openrouter',
  },
  {
    name: 'local-llm',
    type: 'provider',
    description: 'Sell local LLM capacity (Ollama, llama.cpp)',
    package: '@antseed/provider-local-llm',
  },
  {
    name: 'local-proxy',
    type: 'router',
    description: 'Local HTTP proxy for Claude Code, Aider, Codex',
    package: '@antseed/router-local-proxy',
  },
  {
    name: 'local-chat',
    type: 'router',
    description: 'Local desktop chat router',
    package: '@antseed/router-local-chat',
  },
]
