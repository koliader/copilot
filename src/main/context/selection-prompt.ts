import type { AnswerKind, SelectionSettings } from '@shared/types'
export function selectionPrompt(text: string, kind: AnswerKind, settings: SelectionSettings) {
  const prompt = settings.prompt + (kind === 'deep' ? '\nДай развёрнутый ответ с объяснением и примером.' : '')
  return { messages: [{ role: 'system' as const, content: prompt }, { role: 'user' as const, content: text }], maxTokens: kind === 'deep' ? 1500 : 400, temperature: settings.temperature, preset: 'selection/1/' + kind }
}
