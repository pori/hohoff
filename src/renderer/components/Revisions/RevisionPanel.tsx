import { useEffect, useState } from 'react'
import { diffLines } from 'diff'
import type { Change } from 'diff'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useEditorStore } from '../../store/editorStore'
import { currentEditorView } from '../Editor/MarkdownEditor'
import type { RevisionMeta } from '../../types/editor'
import './RevisionPanel.css'

// ─── Diff view ────────────────────────────────────────────────────────────────

const CONTEXT_LINES = 3

type Segment =
  | { kind: 'changed'; changes: Change[] }
  | { kind: 'context'; lines: string[]; segIndex: number }

interface DiffViewProps {
  oldText: string
  newText: string
  expandedSegments: Set<number>
  onExpand: (segIndex: number) => void
}

function DiffView({ oldText, newText, expandedSegments, onExpand }: DiffViewProps): JSX.Element {
  const changes = diffLines(oldText, newText)

  // Build flat list of segments: changed hunks and unchanged context runs
  const segments: Segment[] = []
  let pendingLines: string[] = []
  let segCounter = 0

  const flushContext = (): void => {
    if (pendingLines.length > 0) {
      segments.push({ kind: 'context', lines: pendingLines, segIndex: segCounter++ })
      pendingLines = []
    }
  }

  for (const change of changes) {
    if (change.added || change.removed) {
      flushContext()
      const last = segments[segments.length - 1]
      if (last?.kind === 'changed') {
        last.changes.push(change)
      } else {
        segments.push({ kind: 'changed', changes: [change] })
      }
    } else {
      const lines = change.value.split('\n')
      if (lines[lines.length - 1] === '') lines.pop()
      pendingLines.push(...lines)
    }
  }
  flushContext()

  if (segments.length === 0 || !changes.some((c) => c.added || c.removed)) {
    return <p className="revision-preview-empty">No changes — this revision matches the current content.</p>
  }

  return (
    <div className="rdiff-root">
      {segments.map((seg, i) => {
        if (seg.kind === 'changed') {
          return (
            <div key={i} className="rdiff-hunk">
              {seg.changes.flatMap((ch, j) => {
                const prefix = ch.added ? '+' : '-'
                const cls = ch.added ? 'rdiff-line--added' : 'rdiff-line--removed'
                const lines = ch.value.split('\n')
                if (lines[lines.length - 1] === '') lines.pop()
                return lines.map((line, k) => (
                  <div key={`${j}-${k}`} className={`rdiff-line ${cls}`}>
                    <span className="rdiff-gutter">{prefix}</span>
                    <span className="rdiff-text">{line || '\u00A0'}</span>
                  </div>
                ))
              })}
            </div>
          )
        }

        const { lines, segIndex } = seg
        const total = lines.length
        const isExpanded = expandedSegments.has(segIndex)

        if (total <= CONTEXT_LINES * 2 || isExpanded) {
          return (
            <div key={i} className="rdiff-context">
              {lines.map((line, k) => (
                <div key={k} className="rdiff-line rdiff-line--context">
                  <span className="rdiff-gutter"> </span>
                  <span className="rdiff-text">{line || '\u00A0'}</span>
                </div>
              ))}
            </div>
          )
        }

        const topLines = lines.slice(0, CONTEXT_LINES)
        const bottomLines = lines.slice(total - CONTEXT_LINES)
        const hiddenCount = total - CONTEXT_LINES * 2

        return (
          <div key={i} className="rdiff-context">
            {topLines.map((line, k) => (
              <div key={`t${k}`} className="rdiff-line rdiff-line--context">
                <span className="rdiff-gutter"> </span>
                <span className="rdiff-text">{line || '\u00A0'}</span>
              </div>
            ))}
            <button className="rdiff-collapse-btn" onClick={() => onExpand(segIndex)}>
              ··· {hiddenCount} unchanged line{hiddenCount !== 1 ? 's' : ''} ···
            </button>
            {bottomLines.map((line, k) => (
              <div key={`b${k}`} className="rdiff-line rdiff-line--context">
                <span className="rdiff-gutter"> </span>
                <span className="rdiff-text">{line || '\u00A0'}</span>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const isYesterday = d.toDateString() === new Date(now.getTime() - 86400000).toDateString()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (isToday) return `Today, ${time}`
  if (isYesterday) return `Yesterday, ${time}`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' + time
}

// ─── RevisionPanel ────────────────────────────────────────────────────────────

type ViewMode = 'diff' | 'preview'

export function RevisionPanel(): JSX.Element {
  const { activeFilePath, activeFileContent, toggleRevisionPanel, revisions, setRevisions } =
    useEditorStore()
  const [selected, setSelected] = useState<RevisionMeta | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewRaw, setPreviewRaw] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('diff')
  const [expandedSegments, setExpandedSegments] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!activeFilePath) return
    window.api.listRevisions(activeFilePath).then(setRevisions)
    setSelected(null)
    setPreviewHtml(null)
    setPreviewRaw(null)
  }, [activeFilePath])

  const selectRevision = async (rev: RevisionMeta): Promise<void> => {
    if (selected?.id === rev.id) return
    setSelected(rev)
    setPreviewHtml(null)
    setPreviewRaw(null)
    setViewMode('diff')
    setExpandedSegments(new Set())
    if (!activeFilePath) return
    setLoading(true)
    try {
      const content = await window.api.loadRevision(activeFilePath, rev.id)
      setPreviewRaw(content)
      const html = await marked.parse(content)
      setPreviewHtml(DOMPurify.sanitize(html))
    } finally {
      setLoading(false)
    }
  }

  const restore = (): void => {
    if (previewRaw === null) return
    const view = currentEditorView
    if (view) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: previewRaw }
      })
    }
    toggleRevisionPanel()
  }

  const deleteRev = async (e: React.MouseEvent, rev: RevisionMeta): Promise<void> => {
    e.stopPropagation()
    if (!activeFilePath) return
    await window.api.deleteRevision(activeFilePath, rev.id)
    const updated = revisions.filter((r) => r.id !== rev.id)
    setRevisions(updated)
    if (selected?.id === rev.id) {
      setSelected(null)
      setPreviewHtml(null)
      setPreviewRaw(null)
    }
  }

  return (
    <div className="revision-panel">
      <div className="revision-panel-header">
        <button className="revision-back-btn" onClick={toggleRevisionPanel} title="Close">
          ←
        </button>
        <span className="revision-panel-title">Revision History</span>
      </div>
      <div className="revision-panel-body">

        {/* ── Left: revision list ── */}
        <div className="revision-list">
          {revisions.length === 0 ? (
            <p className="revision-empty">No revisions yet.<br />Save with ⌘S to create one.</p>
          ) : (
            revisions.map((rev) => (
              <div
                key={rev.id}
                className={`revision-entry${selected?.id === rev.id ? ' selected' : ''}`}
                onClick={() => selectRevision(rev)}
              >
                <div className="revision-entry-date">{formatDate(rev.timestamp)}</div>
                <div className="revision-entry-words">{rev.wordCount.toLocaleString()} words</div>
                <button
                  className="revision-entry-delete"
                  onClick={(e) => deleteRev(e, rev)}
                  title="Delete revision"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>

        {/* ── Right: preview / diff ── */}
        <div className="revision-preview">
          {selected === null ? (
            <p className="revision-preview-empty">Select a revision to preview</p>
          ) : loading ? (
            <p className="revision-preview-empty">Loading…</p>
          ) : previewRaw !== null ? (
            <>
              <div className="revision-view-toggle">
                <button
                  className={`revision-view-btn${viewMode === 'diff' ? ' active' : ''}`}
                  onClick={() => setViewMode('diff')}
                >
                  Diff
                </button>
                <button
                  className={`revision-view-btn${viewMode === 'preview' ? ' active' : ''}`}
                  onClick={() => setViewMode('preview')}
                >
                  Preview
                </button>
              </div>

              <div className="revision-preview-scroll">
                {viewMode === 'diff' ? (
                  <DiffView
                    oldText={previewRaw}
                    newText={activeFileContent}
                    expandedSegments={expandedSegments}
                    onExpand={(idx) =>
                      setExpandedSegments((prev) => new Set([...prev, idx]))
                    }
                  />
                ) : (
                  <div
                    className="revision-preview-content"
                    dangerouslySetInnerHTML={{ __html: previewHtml ?? '' }}
                  />
                )}
              </div>

              <div className="revision-preview-footer">
                <button className="revision-restore-btn" onClick={restore}>
                  Restore this version
                </button>
              </div>
            </>
          ) : null}
        </div>

      </div>
    </div>
  )
}
