import { importOverlay } from '@shared/import-overlay'
import { useState } from 'react'
import type { Ctx } from '../App'
import { api } from '../../lib/api'
import { useAsync } from '../../lib/hooks'
import { DEFAULT_SELECTION_PROMPT } from '@shared/selection'
export function InputTab({ ctx }: { ctx: Ctx }) {
  const s = ctx.settings
  const [prompt, setPrompt] = useState(s.selection.prompt)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<ReturnType<typeof importOverlay> | null>(null)
  const [providers] = useAsync(() => api.providers.list(), [])
  const selected = s.selection.target?.providerId ?? ''
  const [models, setModels] = useState<string[]>([])
  const patch = async (p: Parameters<typeof ctx.patch>[0]) => { try { await ctx.patch(p); setError('') } catch (e) { setError(String(e)) } }
  return <div className="col" style={{ gap: 16 }}>
    <h2>Ввод вопроса</h2>
    <select className="input" value={s.inputMode} onChange={e => void patch({ inputMode: e.target.value as 'selection' | 'voice' })}>
      <option value="selection">Выделенный текст + Ctrl</option><option value="voice">Голос</option>
    </select>
    <p>Выделите текст в другой программе и отпустите одиночный Ctrl. Ctrl+C/V/A работают как обычно. Esc скрывает, двойной Esc отменяет. Ctrl+Alt+X отключает горячие клавиши, Ctrl+Alt+U завершает приложение. Ctrl+Alt+S открывает главное окно настроек.</p>
    <label>Провайдер для выделения<select className="input" value={selected} onChange={e => { setModels([]); void patch({ selection: { target: e.target.value ? { providerId: e.target.value, model: 'qwen3.5:9b' } : null } }) }}>
      <option value="">Использовать роль «Быстрый ответ»</option>{providers?.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
    </select></label>
    {selected && <><input className="input" list="selection-models" value={s.selection.target?.model ?? ''} onChange={e => void patch({ selection: { target: { providerId: selected, model: e.target.value } } })} />
      <datalist id="selection-models">{models.map(m => <option key={m} value={m}/>)}</datalist>
      <button className="btn" onClick={() => void api.providers.models(selected, true).then(ms => setModels(ms.map(m => m.id))).catch(e => setError(String(e)))}>Получить установленные модели</button></>}
    <details><summary>Назначения клавиш (латинские имена, ctrl+alt+s)</summary>{(['send', 'settings', 'toggle', 'quit'] as const).map(action => <label key={action}>{action}<input className="input" defaultValue={s.selection.hotkeys[action]} onBlur={e => void patch({ selection: { hotkeys: { [action]: e.target.value.trim().toLowerCase() } } })}/></label>)}</details>
    <label>Промпт<textarea className="input" rows={6} value={prompt} onChange={e => setPrompt(e.target.value)}/></label>
    <div className="row"><button className="btn" onClick={() => void patch({ selection: { prompt } })}>Сохранить промпт</button><button className="btn" onClick={() => setPrompt(DEFAULT_SELECTION_PROMPT)}>Исходный промпт</button></div>
    <label>Температура<input className="input" type="number" min="0" max="2" step="0.1" value={s.selection.temperature} onChange={e => void patch({ selection: { temperature: Number(e.target.value) } })}/></label>
    <label>Think (native Ollama)<select className="input" value={String(s.selection.think)} onChange={e => void patch({ selection: { think: e.target.value === 'null' ? null : e.target.value === 'true' } })}><option value="false">Выключен</option><option value="true">Включён</option><option value="null">По умолчанию модели</option></select></label>
    <p>Общий таймаут включает загрузку модели и ожидание первого ответа Ollama.</p>
    <label>Общий таймаут, секунд<input className="input" type="number" value={s.selection.timeoutMs / 1000} onChange={e => void patch({ selection: { timeoutMs: Number(e.target.value) * 1000 } })}/></label>
    <label>Символов в компактном ответе (0 — весь)<input className="input" type="number" value={s.selection.maxChars} onChange={e => void patch({ selection: { maxChars: Number(e.target.value) } })}/></label>
    <textarea className="input" placeholder="Проверка ручным вопросом без микрофона" value={typed} onChange={e => setTyped(e.target.value)}/>
    <button className="btn primary" disabled={!typed.trim()} onClick={() => void api.session.askTyped(typed).catch(e => setError(String(e)))}>Отправить вопрос</button>
    <label>Импорт settings.json / overlay_settings.json<input type="file" accept=".json" onChange={async e => { try { const file = e.target.files?.[0]; if (!file) return; if (file.size > 1000000) throw new Error('Файл слишком большой'); setPreview(importOverlay(JSON.parse(await file.text()))) } catch (e) { setError(String(e)) } }}/></label>
    {preview && <div className="col"><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(preview, null, 2)}</pre><p>Неперенесённые поля перечислены в skipped. Внешний вид остаётся текущим; импортируемые клавиши показаны выше.</p><button className="btn" onClick={async () => {
      try {
        await ctx.patch(preview.patch)
        if (preview.host && preview.model) {
          await api.providers.upsert({ id: 'imported-overlay', label: 'Ollama Overlay import', preset: 'ollama', protocol: 'openai', baseUrl: preview.host + '/v1', hasKey: false, allowFallback: false, timeoutMs: 300000 })
          await ctx.patch({ selection: { target: { providerId: 'imported-overlay', model: preview.model } } })
        }
        setPreview(null); setError('');
      } catch (e) { setError(String(e)) }
    }}>Применить просмотренный импорт</button></div>}
    {s.shortcuts.snapRegion.toLowerCase() === 'control+alt+s' && <p>Конфликт: Ctrl+Alt+S открывает настройки в режиме выделения. Для снимка назначьте другое сочетание в разделе горячих клавиш.</p>}
    {error && <div className="error">{error}</div>}
  </div>
}
