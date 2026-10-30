import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
export interface HelperMessage { type: string; version?: number; epoch?: number; text?: string; action?: string; value?: string }
export class SelectionHelper {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  epoch = 0
  constructor(private receive: (m: HelperMessage) => void) {}
  start(executable: string): void {
    if (this.child) return
    this.buffer = ''
    const child = spawn(executable, [], { windowsHide: true, stdio: 'pipe' })
    this.child = child
    let ready = false
    const timer = setTimeout(() => { if (this.child === child && !ready) { this.receive({ type: 'error' }); this.stop() } }, 15000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (this.child !== child) return
      this.buffer += chunk
      if (this.buffer.length > 262144) { this.stop(); return }
      let end: number
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1)
        try {
          const m = JSON.parse(line) as HelperMessage
          if (m.type === 'ready') { if (m.version !== 1) { this.stop(); return }; ready = true; clearTimeout(timer) }
          if (!ready || (m.epoch !== undefined && m.epoch !== this.epoch) || (m.type === 'selection' && (m.epoch !== this.epoch || typeof m.text !== 'string' || m.text.length > 32000))) continue
          this.receive(m)
        } catch { this.receive({ type: 'error' }) }
      }
    })
    child.stderr.resume()
    child.stdin.on('error', () => {})
    child.on('error', () => { if (this.child === child) this.receive({ type: 'error' }) })
    child.on('exit', () => { clearTimeout(timer); if (this.child === child) { this.child = null; this.receive({ type: 'error' }) } })
  }
  configure(active: boolean, exclude: string[], hotkeys: object, enabled = true): void { this.epoch++; this.send({ type: 'configure', active, exclude, hotkeys, enabled, ownerPid: process.pid, epoch: this.epoch }) }
  cancel(): void { this.epoch++; this.send({ type: 'cancel', epoch: this.epoch }) }
  private send(m: object): void { this.child?.stdin.write(JSON.stringify(m) + '\n') }
  stop(): void {
    const child = this.child
    this.cancel(); this.send({ type: 'shutdown' }); this.child = null; this.buffer = ''
    child?.stdin.end()
    if (child) { const timer = setTimeout(() => child.kill(), 1000); timer.unref() }
  }
}
