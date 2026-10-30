import { describe, it, expect } from 'vitest'
import { OllamaAdapter } from '../src/main/providers/ollama-native'
import { DEFAULT_SETTINGS, SettingsStore } from '../src/main/storage/settings'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cfg = { id: 'ollama', label: 'Ollama', preset: 'ollama' as const, protocol: 'openai' as const, baseUrl: 'http://127.0.0.1:11434/v1', hasKey: false, allowFallback: false, timeoutMs: 300000 }
const req = { model: 'qwen3.5:9b', messages: [], maxTokens: 400, temperature: 0, selection: { prompt: 'Кратко', text: 'Вопрос', think: false, connectTimeoutMs: 5000 } }
it('native Ollama serializes exact selection prompt and parses split UTF8 NDJSON', async () => {
  let payload: Record<string, unknown> = {}
  const a = new OllamaAdapter({ cfg, apiKey: null, fetch: async (url, init) => {
    expect(url).toBe('http://127.0.0.1:11434/api/generate')
    payload = JSON.parse(String(init?.body))
    const bytes = new TextEncoder().encode('{"response":"Ответ","done":false}\n{"done":true}')
    return new Response(new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 17)); c.enqueue(bytes.slice(17)); c.close() } }))
  } })
  const chunks = []
  for await (const c of a.stream(req, new AbortController().signal)) chunks.push(c)
  expect(payload).toMatchObject({ model: req.model, prompt: 'Кратко\n\nТекст:\nВопрос', stream: true, think: false, options: { temperature: 0 } })
  expect(chunks[0]).toEqual({ type: 'text', text: 'Ответ' })
})
it('rejects EOF without done', async () => {
  const a = new OllamaAdapter({ cfg, apiKey: null, fetch: async () => new Response('{"response":"partial"}\n') })
  await expect(async () => { for await (const _ of a.stream(req, new AbortController().signal)) { void _ } }).rejects.toThrow('before done')
})
describe('settings preservation', () => {
  const paths = () => { const dir = mkdtempSync(join(tmpdir(), 'selection-')); return [join(dir, 'settings.json'), join(dir, 'providers.json')] as const }
  it('keeps old shortcuts and voice mode with a backup', () => {
    const [p, providers] = paths()
    writeFileSync(p, JSON.stringify({ shortcuts: { snapRegion: 'Control+Alt+S' } }))
    const store = new SettingsStore(p, providers)
    expect(store.get().inputMode).toBe('voice')
    expect(store.get().shortcuts.snapRegion).toBe('Control+Alt+S')
    expect(readFileSync(p + '.pre-selection.bak', 'utf8')).toContain('Control+Alt+S')
  })
  it('does not replace malformed or future settings', () => {
    for (const value of ['{bad', '{"schemaVersion":99}']) {
      const [p, providers] = paths(); writeFileSync(p, value)
      expect(() => new SettingsStore(p, providers)).toThrow()
      expect(readFileSync(p, 'utf8')).toBe(value)
    }
  })
  it('defaults to selection and refuses invalid patches', () => {
    const [p, providers] = paths(); const store = new SettingsStore(p, providers)
    expect(store.get().inputMode).toBe('selection')
    expect(() => store.patch({ selection: { timeoutMs: -1 } })).toThrow()
    expect(store.get().selection.timeoutMs).toBe(DEFAULT_SETTINGS.selection.timeoutMs)
  })
})

it('reads a PowerShell UTF8 BOM settings file without losing the model', () => {
  const dir = mkdtempSync(join(tmpdir(), 'selection-bom-'))
  const file = join(dir, 'settings.json')
  writeFileSync(file, '\ufeff' + JSON.stringify({ schemaVersion: 1, selection: { target: { providerId: 'local', model: 'qwen3.5:9b' } } }))
  const store = new SettingsStore(file, join(dir, 'providers.json'))
  expect(store.get().selection.target?.model).toBe('qwen3.5:9b')
})

// A slow first response is normal while a local model is loading.
it('waits for model loading beyond the legacy connection timeout', async () => {
  const signal = new AbortController().signal
  const a = new OllamaAdapter({ cfg, apiKey: null, fetch: async (_url, init) => {
    expect(init?.signal).toBe(signal)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(init?.signal?.aborted).toBe(false)
    return new Response('{"response":"OK","done":true}\n')
  } })
  const chunks = []
  for await (const c of a.stream({ ...req, selection: { ...req.selection, connectTimeoutMs: 1 } }, signal)) chunks.push(c)
  expect(chunks[0]).toEqual({ type: 'text', text: 'OK' })
})

it.each(['http://127.0.0.1:11434', 'http://127.0.0.1:11434/', 'http://127.0.0.1:11434/v1', 'http://127.0.0.1:11434/v1/'])(
  'uses /v1/chat/completions for ordinary requests with base %s', async baseUrl => {
    const a = new OllamaAdapter({ cfg: { ...cfg, baseUrl }, apiKey: null, fetch: async (url) => {
      expect(url).toBe('http://127.0.0.1:11434/v1/chat/completions')
      return new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n')
    } })
    const chunks = []
    for await (const c of a.stream({ ...req, selection: undefined }, new AbortController().signal)) chunks.push(c)
    expect(chunks[0]).toEqual({ type: 'text', text: 'OK' })
  }
)

it('preserves native Ollama HTTP errors for the UI', async () => {
  const a = new OllamaAdapter({ cfg, apiKey: null, fetch: async () => new Response('{"error":"model missing"}', { status: 404 }) })
  await expect(async () => { for await (const _ of a.stream(req, new AbortController().signal)) { void _ } }).rejects.toMatchObject({ appError: { code: 'not_found', status: 404 } })
})
