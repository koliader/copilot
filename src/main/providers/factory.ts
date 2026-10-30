import { AnthropicAdapter } from './anthropic'
import type { AdapterDeps, ProviderAdapter } from './adapter'
import { GeminiAdapter } from './gemini'
import { OllamaAdapter } from './ollama-native'
import { OpenAiAdapter } from './openai'

export function createAdapter(deps: AdapterDeps): ProviderAdapter {
  if (deps.cfg.preset === 'ollama') return new OllamaAdapter(deps)
  switch (deps.cfg.protocol) {
    case 'anthropic':
      return new AnthropicAdapter(deps)
    case 'gemini':
      return new GeminiAdapter(deps)
    default:
      return new OpenAiAdapter(deps)
  }
}
