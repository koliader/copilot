import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { DeepPartial, ProviderConfig, Settings } from '@shared/types'

import { DEFAULT_SELECTION_PROMPT } from '@shared/selection'

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  inputMode: 'selection',
  selection: { hotkeys: { send: 'ctrl', settings: 'ctrl+alt+s', toggle: 'ctrl+alt+x', quit: 'ctrl+alt+u' }, prompt: DEFAULT_SELECTION_PROMPT, temperature: 0, think: false, timeoutMs: 300000, connectTimeoutMs: 5000, maxChars: 300, target: null },
  onboarded: false,
  uiLang: 'ru',
  answerLang: 'auto',
  offline: false,
  autoAnswer: false,
  asr: { backend: 'cpu', model: 'base', language: 'ru', vocabulary: ['PostgreSQL', 'FastAPI', 'Kubernetes', 'Docker', 'React', 'TypeScript'], threads: 6 },
  audio: { micDeviceId: null, captureMic: true, captureSystem: true },
  contextWindowMin: 3,
  overlay: {
    bounds: null,
    displayId: null,
    opacity: 0.94,
    fontScale: 1,
    expanded: false,
    theme: 'dark',
    protect: true,
    pinned: true
  },
  shortcuts: {
    toggleOverlay: 'Control+Alt+H',
    toggleListen: 'Control+Alt+L',
    answerNow: 'Control+Alt+Enter',
    snapRegion: 'Control+Alt+P',
    scrollUp: 'Control+Alt+Up',
    scrollDown: 'Control+Alt+Down',
    expand: 'Control+Alt+E',
    panic: 'Control+Alt+Backspace'
  },
  history: true,
  budget: { perSessionUsd: null, perDayUsd: null, requestsPerMinute: 20, maxConcurrent: 2 },
  pricing: {},
  roles: {},
  activeProfileId: 'default',
  consent: { mic: false, system: false, screen: false, cloud: false, history: false, participants: false, acceptedAt: null },
  window: { minimizeToTray: true, protectFromCapture: true, panicQuits: false }
}

export function deepMerge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return (patch ?? base) as T
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k]
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)
        ? deepMerge(cur, v as DeepPartial<typeof cur>)
        : v
  }
  return out as T
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

function writeJson(path: string, value: unknown): void {
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, path)
}

export class SettingsStore {
  private current: Settings
  private providerList: ProviderConfig[]

  constructor(
    private settingsPath: string,
    private providersPath: string
  ) {
    let saved: DeepPartial<Settings> | undefined
    if (existsSync(settingsPath)) {
      // Refuse damaged/future files instead of silently replacing the user's settings.
      saved = JSON.parse(readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, ''))
      if (!saved || typeof saved !== 'object' || Array.isArray(saved) || (saved.schemaVersion ?? 0) > 1) throw new Error('Неподдерживаемый файл настроек')
      if (!saved.schemaVersion) {
        copyFileSync(settingsPath, settingsPath + '.pre-selection.bak')
        saved = { ...saved, schemaVersion: 1, inputMode: 'voice' }
      }
    }
    this.current = deepMerge(DEFAULT_SETTINGS, saved)
    this.providerList = readJson<ProviderConfig[]>(providersPath) ?? []
  }

  get(): Settings {
    return this.current
  }

  patch(p: DeepPartial<Settings>): Settings {
    const next = deepMerge(this.current, p)
    const v = next.selection
    const keys = Object.values(v.hotkeys)
    if (keys.length !== 4 || new Set(keys).size !== 4 || keys.some(k => typeof k !== 'string' || !/^[a-z0-9 ]+(\+[a-z0-9 ]+)*$/.test(k) || k.includes('esc'))) throw new Error('Некорректные или повторяющиеся клавиши')
    if (!['selection', 'voice'].includes(next.inputMode) || next.schemaVersion !== 1 || typeof v.prompt !== 'string' || !v.prompt.trim() || v.prompt.length > 32000 ||
        !Number.isFinite(v.temperature) || v.temperature < 0 || v.temperature > 2 ||
        !Number.isFinite(v.timeoutMs) || v.timeoutMs < 1000 || v.timeoutMs > 3600000 ||
        !Number.isFinite(v.connectTimeoutMs) || v.connectTimeoutMs < 100 || v.connectTimeoutMs > 120000 ||
        !Number.isInteger(v.maxChars) || v.maxChars < 0 || v.maxChars > 32000 ||
        ![true, false, null].includes(v.think)) throw new Error('Некорректные настройки ввода')
    writeJson(this.settingsPath, next)
    this.current = next
    return this.current
  }

  providers(): ProviderConfig[] {
    return this.providerList
  }

  saveProviders(list: ProviderConfig[]): void {
    this.providerList = list
    writeJson(this.providersPath, list)
  }
}
