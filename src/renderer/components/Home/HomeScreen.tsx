import { useEffect, useState } from 'react'
import type { TelemetrySession } from '../../types/editor'
import { useEditorStore } from '../../store/editorStore'
import './HomeScreen.css'

interface Stats {
  projectWordCount: number
  wordsToday: number
  streak: number
  avgWpm: number
}

interface RecentFile {
  path: string
  name: string
  lastSeen: number
  wordsAdded: number
}

interface Excerpt {
  text: string
  source: string
}

function countWords(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length
}

function computeStats(sessions: TelemetrySession[], projectWordCount: number): Stats {
  const todayStart = new Date().setHours(0, 0, 0, 0)
  let wordsToday = 0
  let totalWordsForWpm = 0
  let totalMinutesForWpm = 0
  const daySet = new Set<string>()

  for (const s of sessions) {
    const sessionWords = Object.values(s.files).reduce((sum, f) => sum + Math.max(0, f.wordsAdded), 0)
    const sessionMinutes = (s.endedAt - s.startedAt) / 60000

    if (s.startedAt >= todayStart) wordsToday += sessionWords

    if (sessionWords > 5 && sessionMinutes > 0.5) {
      totalWordsForWpm += sessionWords
      totalMinutesForWpm += sessionMinutes
    }

    if (sessionWords > 0) {
      daySet.add(new Date(s.startedAt).toDateString())
    }
  }

  let streak = 0
  const checkDate = new Date()
  while (daySet.has(checkDate.toDateString())) {
    streak++
    checkDate.setDate(checkDate.getDate() - 1)
  }

  const avgWpm = totalMinutesForWpm > 0 ? Math.round(totalWordsForWpm / totalMinutesForWpm) : 0

  return { projectWordCount, wordsToday, streak, avgWpm }
}

function getRecentFiles(sessions: TelemetrySession[]): RecentFile[] {
  const fileMap: Record<string, { lastSeen: number; wordsAdded: number }> = {}
  for (const s of sessions) {
    for (const [path, stats] of Object.entries(s.files)) {
      if (!fileMap[path] || s.endedAt > fileMap[path].lastSeen) {
        fileMap[path] = { lastSeen: s.endedAt, wordsAdded: (fileMap[path]?.wordsAdded ?? 0) + Math.max(0, stats.wordsAdded) }
      }
    }
  }
  return Object.entries(fileMap)
    .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
    .slice(0, 6)
    .map(([path, data]) => ({
      path,
      name: path.split('/').pop()?.replace(/\.md$/, '') ?? path,
      lastSeen: data.lastSeen,
      wordsAdded: data.wordsAdded
    }))
}

function pickExcerpt(files: { relativePath: string; content: string }[]): Excerpt | null {
  const candidates: { text: string; source: string }[] = []
  for (const file of files) {
    const name = file.relativePath.split('/').pop()?.replace(/\.md$/, '') ?? file.relativePath
    const blocks = file.content.split(/\n{2,}/)
    for (const block of blocks) {
      const clean = block.replace(/^#{1,6}\s[^\n]*/gm, '').trim()
      if (clean.startsWith('>') || clean.startsWith('#')) continue
      const words = countWords(clean)
      if (words < 15) continue
      const wordList = clean.split(/\s+/)
      const text = wordList.length > 60 ? wordList.slice(0, 60).join(' ') + '…' : clean
      candidates.push({ text, source: name })
    }
  }
  if (candidates.length === 0) return null
  const today = new Date()
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate()
  return candidates[seed % candidates.length]
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

export function HomeScreen(): JSX.Element {
  const { setActiveFile, activeFilePath, leaveHome } = useEditorStore()
  const [stats, setStats] = useState<Stats | null>(null)
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([])
  const [excerpt, setExcerpt] = useState<Excerpt | null>(null)
  const [projectTitle, setProjectTitle] = useState('Your Manuscript')

  useEffect(() => {
    async function load(): Promise<void> {
      const [telemetry, projectWordCount, allFiles, cfg] = await Promise.all([
        window.api.readTelemetry(),
        window.api.getProjectWordCount(),
        window.api.readAllDraftFiles(),
        window.api.readConfig()
      ])

      setStats(computeStats(telemetry.sessions, projectWordCount))
      setRecentFiles(getRecentFiles(telemetry.sessions))
      setExcerpt(pickExcerpt(allFiles))
      if (cfg.projectTitle) setProjectTitle(cfg.projectTitle)
    }
    load().catch(console.error)
  }, [])

  async function openFile(path: string): Promise<void> {
    const content = await window.api.readFile(path)
    setActiveFile(path, content)
  }

  async function resumeWriting(): Promise<void> {
    if (activeFilePath) {
      leaveHome()
      return
    }
    if (recentFiles.length > 0) {
      await openFile(recentFiles[0].path)
    }
  }

  return (
    <div className="home-screen">
      <div className="home-content">
        <h1 className="home-title">{projectTitle}</h1>

        {stats && (
          <div className="home-stats">
            <div className="home-stat">
              <span className="home-stat-value">{stats.projectWordCount.toLocaleString()}</span>
              <span className="home-stat-label">total words</span>
            </div>
            <div className="home-stat">
              <span className="home-stat-value">{stats.wordsToday > 0 ? `+${stats.wordsToday.toLocaleString()}` : '—'}</span>
              <span className="home-stat-label">today</span>
            </div>
            <div className="home-stat">
              <span className="home-stat-value">{stats.streak > 0 ? stats.streak : '—'}</span>
              <span className="home-stat-label">{stats.streak === 1 ? 'day streak' : 'day streak'}</span>
            </div>

          </div>
        )}

        {excerpt && (
          <div className="home-excerpt">
            <p className="home-excerpt-text">{excerpt.text}</p>
            <span className="home-excerpt-source">— {excerpt.source}</span>
          </div>
        )}

        {recentFiles.length > 0 && (
          <div className="home-recent">
            <h2 className="home-recent-heading">Recent</h2>
            <ul className="home-recent-list">
              {recentFiles.map(f => (
                <li key={f.path} className="home-recent-item" onClick={() => openFile(f.path)}>
                  <span className="home-recent-name">{f.name}</span>
                  <span className="home-recent-meta">
                    {f.wordsAdded > 0 && <span>+{f.wordsAdded.toLocaleString()} words</span>}
                    <span>{relativeTime(f.lastSeen)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(activeFilePath || recentFiles.length > 0) && (
          <button className="home-resume-btn" onClick={resumeWriting}>
            Resume writing
          </button>
        )}
      </div>
    </div>
  )
}
