import { randomUUID } from 'crypto'
import { readTelemetry, writeTelemetry } from './fileSystem'
import type { CompletedSession } from './fileSystem'

const IDLE_MS = 15 * 60 * 1000

interface FileSnapshot {
  baseline: number
  current: number
}

interface ActiveSession {
  id: string
  startedAt: number
  files: Record<string, FileSnapshot>
  idleTimer: ReturnType<typeof setTimeout> | null
}

let active: ActiveSession | null = null

async function persistSession(session: CompletedSession): Promise<void> {
  const data = await readTelemetry()
  data.sessions.push(session)
  await writeTelemetry(data)
}

function endSession(): void {
  if (!active) return
  const endedAt = Date.now()
  const files: CompletedSession['files'] = {}
  for (const [path, snap] of Object.entries(active.files)) {
    const diff = snap.current - snap.baseline
    files[path] = {
      wordsAdded: Math.max(0, diff),
      wordsRemoved: Math.max(0, -diff),
      netWords: diff
    }
  }
  const session: CompletedSession = { id: active.id, startedAt: active.startedAt, endedAt, files }
  active = null
  persistSession(session).catch(console.error)
}

export function onWordSnapshot(filePath: string, wordCount: number): void {
  if (!active) {
    active = {
      id: randomUUID(),
      startedAt: Date.now(),
      files: { [filePath]: { baseline: wordCount, current: wordCount } },
      idleTimer: null
    }
  } else {
    if (!active.files[filePath]) {
      active.files[filePath] = { baseline: wordCount, current: wordCount }
    } else {
      active.files[filePath].current = wordCount
    }
  }

  if (active.idleTimer) clearTimeout(active.idleTimer)
  active.idleTimer = setTimeout(endSession, IDLE_MS)
}

export function flushTelemetry(): void {
  if (active?.idleTimer) clearTimeout(active.idleTimer)
  endSession()
}
