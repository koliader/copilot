import type { DeepPartial, Settings } from './types'
export function importOverlay(raw: unknown): { patch: DeepPartial<Settings>; host: string | null; model: string | null; skipped: string[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Нужен JSON объект настроек')
  const r = raw as Record<string, unknown>
  if (r.version !== undefined && r.version !== 1) throw new Error('Версия настроек не поддерживается')
  const o = r.ollama as Record<string, unknown> | undefined
  if (!o) return { patch: {}, host: null, model: null, skipped: Object.keys(r) }
  const selection: DeepPartial<Settings['selection']> = {}
  for (const k of ['prompt', 'temperature', 'think'] as const) if (o[k] !== undefined) Object.assign(selection, { [k]: o[k] })
  if (o.connect_timeout !== undefined) selection.connectTimeoutMs = Number(o.connect_timeout) * 1000
  if (o.request_timeout !== undefined) selection.timeoutMs = Number(o.request_timeout) * 1000
  if (r.hotkeys && typeof r.hotkeys === 'object') { const h = r.hotkeys as Record<string, unknown>; if (['send', 'settings', 'toggle', 'quit'].every(k => typeof h[k] === 'string')) selection.hotkeys = { send: String(h.send), settings: String(h.settings), toggle: String(h.toggle), quit: String(h.quit) } }
  const host = typeof o.host === 'string' ? o.host.replace(/\/+$/, '') : null
  if (host) { const u = new URL(host); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('Некорректный адрес Ollama') }
  return { patch: { selection }, host, model: typeof o.model === 'string' ? o.model : null, skipped: Object.keys(r).filter(k => !['version', 'ollama', 'hotkeys'].includes(k)) }
}
