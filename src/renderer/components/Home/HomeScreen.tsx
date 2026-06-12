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

interface DayBucket {
  date: string   // 'YYYY-MM-DD'
  label: string  // 'Jun 12'
  added: number
  removed: number
  net: number
}

function buildDailyBuckets(sessions: TelemetrySession[], days = 30): DayBucket[] {
  const buckets: Record<string, { added: number; removed: number }> = {}

  // Pre-fill last N days so empty days still render
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    buckets[key] = { added: 0, removed: 0 }
  }

  for (const s of sessions) {
    const key = new Date(s.startedAt).toISOString().slice(0, 10)
    if (!(key in buckets)) continue
    for (const f of Object.values(s.files)) {
      buckets[key].added += Math.max(0, f.wordsAdded)
      buckets[key].removed += Math.max(0, f.wordsRemoved)
    }
  }

  return Object.entries(buckets).map(([date, v]) => {
    const d = new Date(date + 'T12:00:00')
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return { date, label, added: v.added, removed: v.removed, net: v.added - v.removed }
  })
}

function DailyChart({ sessions }: { sessions: TelemetrySession[] }): JSX.Element {
  const buckets = buildDailyBuckets(sessions, 30)
  const maxVal = Math.max(...buckets.map(b => Math.max(b.added, b.removed)), 1)

  const W = 560
  const H = 100
  const barAreaH = 80
  const barW = Math.floor((W - 1) / buckets.length) - 1
  const gap = Math.floor((W - 1) / buckets.length)

  // Show a label every ~7 days
  const labelStep = Math.ceil(buckets.length / 5)

  return (
    <div className="home-chart">
      <div className="home-section-heading">Activity</div>
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="home-chart-svg" aria-label="Daily word activity">
        {buckets.map((b, i) => {
          const x = i * gap
          const addH = Math.round((b.added / maxVal) * barAreaH)
          const remH = Math.round((b.removed / maxVal) * barAreaH)
          const showLabel = i % labelStep === 0

          const topBarH = Math.max(addH, remH)
          const hasActivity = b.added > 0 || b.removed > 0
          const netLabel = b.net >= 0 ? `+${b.net}` : `−${Math.abs(b.net)}`

          return (
            <g key={b.date}>
              {/* additions bar */}
              {b.added > 0 && (
                <rect
                  x={x}
                  y={barAreaH - addH}
                  width={barW}
                  height={addH}
                  className="chart-bar-add"
                  rx={1}
                >
                  <title>{b.label}: +{b.added} / −{b.removed}</title>
                </rect>
              )}
              {/* removals bar (overlaid, semi-transparent) */}
              {b.removed > 0 && (
                <rect
                  x={x}
                  y={barAreaH - remH}
                  width={barW}
                  height={remH}
                  className="chart-bar-rem"
                  rx={1}
                >
                  <title>{b.label}: +{b.added} / −{b.removed}</title>
                </rect>
              )}
              {/* net word count above bar */}
              {hasActivity && (
                <text
                  x={x + barW / 2}
                  y={barAreaH - topBarH - 4}
                  className="chart-bar-label"
                  textAnchor="middle"
                >
                  {netLabel}
                </text>
              )}
              {/* day label */}
              {showLabel && (
                <text
                  x={x + barW / 2}
                  y={H + 12}
                  className="chart-label"
                  textAnchor="middle"
                >
                  {b.label}
                </text>
              )}
            </g>
          )
        })}
        {/* baseline */}
        <line x1={0} y1={barAreaH} x2={W} y2={barAreaH} className="chart-baseline" />
      </svg>
      <div className="chart-legend">
        <span className="chart-legend-add">additions</span>
        <span className="chart-legend-rem">deletions</span>
      </div>
    </div>
  )
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
  const [sessions, setSessions] = useState<TelemetrySession[]>([])
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
      setSessions(telemetry.sessions)
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

        <DailyChart sessions={sessions} />

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
