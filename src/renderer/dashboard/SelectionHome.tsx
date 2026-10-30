import { useEffect, useState } from 'react'
import type { AppSnapshot } from '@shared/types'
import type { Ctx } from './App'
import { api } from '../lib/api'
export function SelectionHome({ ctx, snap }: { ctx: Ctx; snap: AppSnapshot }) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { setAnswer(snap.answers.deep?.text ?? snap.answers.say?.text ?? '') }, [snap.answers.deep?.text, snap.answers.say?.text])
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); setError('') } catch (e) { setError(String(e)) } }
  return <div className="page col" style={{ gap: 16 }}>
    <h1>Выделенный текст</h1><p>Выделите текст в другой программе → нажмите и отпустите Ctrl. Микрофон и распознавание выключены.</p>
    <div>{snap.state === 'generating' ? 'Генерирую…' : 'Готов к выделению'} · {snap.notice}</div>
    <button className="btn" onClick={() => ctx.go('settings', 'input')}>Настройки ввода и модели</button>
    <textarea className="input" rows={4} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Или введите вопрос здесь"/>
    <button className="btn primary" disabled={!question.trim() || snap.state === 'generating'} onClick={() => void run(() => api.session.askTyped(question))}>Отправить</button>
    <h2>Полный ответ</h2><textarea className="input" rows={10} value={answer} onChange={e => setAnswer(e.target.value)}/>
    <div className="row"><button className="btn" onClick={() => void run(() => api.copy(answer))}>Копировать весь ответ</button><button className="btn" onClick={() => void run(() => api.session.answerNow('deep'))}>Подробнее</button><button className="btn" onClick={() => void run(() => api.overlay.toggle())}>Показать / скрыть</button><button className="btn" onClick={() => void run(() => api.selection.showEdited(answer))}>Показать редактированный ответ</button><button className="btn" onClick={() => void run(() => api.selection.cancel())}>Отменить</button><button className="btn" onClick={() => void run(() => api.session.stop())}>Остановить</button></div>
    {error && <div className="error">{error}</div>}
  </div>
}
