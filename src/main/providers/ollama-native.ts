import type { ChatRequest, StreamChunk } from '@shared/types'
import type { AdapterDeps, ProviderAdapter } from './adapter'
import { OpenAiAdapter } from './openai'
import { fromHttp } from './errors'
export class OllamaAdapter implements ProviderAdapter {
  private chat: OpenAiAdapter
  constructor(private deps: AdapterDeps) {
    const baseUrl = deps.cfg.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1'
    this.chat = new OpenAiAdapter({ ...deps, cfg: { ...deps.cfg, baseUrl } })
  }
  async listModels(signal?: AbortSignal) {
    const res = await this.deps.fetch(this.deps.cfg.baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '') + '/api/tags', { signal })
    if (!res.ok) throw new Error('Ollama HTTP ' + res.status)
    const body = await res.json() as { models?: { name: string }[] }
    if (!Array.isArray(body.models)) throw new Error('Invalid Ollama model list')
    return body.models.map(m => ({ id: m.name, vision: null }))
  }
  async *stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamChunk> {
    if (!req.selection) { yield* this.chat.stream(req, signal); return }
    const sel = req.selection
    // Ollama can send headers only after loading the model and evaluating the prompt.
    // The runner's overall deadline covers this wait; it is not a connection timeout.
    const res = await this.deps.fetch(this.deps.cfg.baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '') + '/api/generate', {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: req.model, prompt: sel.prompt + '\n\nТекст:\n' + sel.text, stream: true, options: { temperature: req.temperature }, ...(sel.think === null ? {} : { think: sel.think }) })
    })
    if (!res.ok) throw fromHttp(res.status, await res.text(), res.headers)
    if (!res.body) throw new Error('Empty Ollama response body')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = '', answer = ''
    try {
      while (true) {
        const { value, done } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        if (buffer.length > 2000000) throw new Error('Ollama response too large')
        const lines = buffer.split('\n'); buffer = lines.pop()!
        if (done && buffer.trim()) { lines.push(buffer); buffer = '' }
        for (const line of lines) {
          if (!line.trim()) continue
          const item = JSON.parse(line)
          if (item.error) throw new Error('Ollama rejected request')
          if (item.response !== undefined && typeof item.response !== 'string') throw new Error('Invalid Ollama response')
          if (item.response) { answer += item.response; yield { type: 'text', text: item.response } }
          if (item.done === true) {
            if (!answer.trim()) throw new Error('Empty Ollama response')
            yield { type: 'usage', inputTokens: item.prompt_eval_count ?? 0, outputTokens: item.eval_count ?? 0 }
            return
          }
        }
        if (done) throw new Error('Ollama stream ended before done')
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  }
}
