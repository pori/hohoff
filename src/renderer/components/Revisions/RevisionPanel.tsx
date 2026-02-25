import { useEffect, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useEditorStore } from '../../store/editorStore'
import { currentEditorView } from '../Editor/MarkdownEditor'
import type { RevisionMeta } from '../../types/editor'
import './RevisionPanel.css'

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

export function RevisionPanel(): JSX.Element {
  const { activeFilePath, toggleRevisionPanel, revisions, setRevisions } = useEditorStore()
  const [selected, setSelected] = useState<RevisionMeta | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewRaw, setPreviewRaw] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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

        <div className="revision-preview">
          {selected === null ? (
            <p className="revision-preview-empty">Select a revision to preview</p>
          ) : loading ? (
            <p className="revision-preview-empty">Loading…</p>
          ) : previewHtml !== null ? (
            <>
              <div
                className="revision-preview-content"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
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
