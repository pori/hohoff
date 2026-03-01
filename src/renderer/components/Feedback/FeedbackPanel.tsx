import { useState, useEffect, useRef } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useEditorStore } from '../../store/editorStore'
import type { TextAnnotation } from '../../types/editor'
import {
  tooltipAnalysisCache,
  cancelPendingDismiss,
  analyseAnnotation,
  scrollToAnnotation,
  applyAnnotation
} from '../Editor/MarkdownEditor'
import './FeedbackPanel.css'

type AnalysisState =
  | { status: 'idle' }
  | { status: 'streaming'; text: string }
  | { status: 'done'; text: string; suggestion: string | null }

function badgeColor(type: TextAnnotation['type']): string {
  switch (type) {
    case 'passive_voice': return 'rgba(255, 200, 0, 0.75)'
    case 'consistency':   return 'rgba(220, 80, 80, 0.75)'
    case 'style':         return 'rgba(80, 160, 255, 0.75)'
    case 'critique':      return 'rgba(160, 80, 220, 0.75)'
    case 'custom':        return 'rgba(30, 200, 150, 0.8)'
  }
}

function renderMarkdown(text: string, streaming: boolean): string {
  const raw = marked.parse(streaming ? text + ' ▋' : text) as string
  return DOMPurify.sanitize(raw)
}

interface FeedbackCardProps {
  ann: TextAnnotation
  autoAnalyse: boolean
  onDismiss: () => void
}

function FeedbackCard({ ann, autoAnalyse, onDismiss }: FeedbackCardProps): JSX.Element {
  const [state, setState] = useState<AnalysisState>(() => {
    const cached = tooltipAnalysisCache.get(ann.id)
    if (cached) return { status: 'done', text: cached.text, suggestion: cached.suggestion }
    // Custom (attachment-driven) annotations already carry their analysis — show
    // the problem description and suggestion immediately without an extra AI call.
    if (ann.type === 'custom') {
      return { status: 'done', text: ann.message, suggestion: ann.suggestion ?? null }
    }
    return { status: 'idle' }
  })

  const cleanupRef = useRef<(() => void) | null>(null)

  function startAnalysis(): void {
    // Prevent double-start
    if (state.status === 'streaming') return
    cleanupRef.current?.()
    setState({ status: 'streaming', text: '' })
    cleanupRef.current = analyseAnnotation(ann, (text, streaming, suggestion) => {
      if (streaming) {
        setState({ status: 'streaming', text })
      } else {
        setState({ status: 'done', text, suggestion })
      }
    })
  }

  // Trigger analysis when parent requests "Analyse all"
  useEffect(() => {
    if (autoAnalyse && state.status === 'idle') {
      startAnalysis()
    }
  }, [autoAnalyse]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => { cleanupRef.current?.() }
  }, [])

  const typeName = ann.type.replace(/_/g, ' ')
  const isSpinning = state.status === 'streaming' && state.text === ''
  const hasText = (state.status === 'streaming' || state.status === 'done') && state.text !== ''
  const suggestion = state.status === 'done' ? state.suggestion : null

  return (
    <div
      className={`fb-card fb-card-${ann.type}`}
      style={{ '--badge-color': badgeColor(ann.type) } as React.CSSProperties}
    >
      {/* Header — click to jump to passage in editor */}
      <div className="fb-card-header" onClick={() => scrollToAnnotation(ann)} title="Jump to passage">
        <div className="fb-card-header-top">
          <div className="fb-card-header-badges">
            <span className="fb-card-badge">{typeName}</span>
            {ann.type === 'custom' && (
              <span className="fb-card-source-tag">from attachment</span>
            )}
          </div>
          <button
            className="fb-card-dismiss"
            onClick={(e) => { e.stopPropagation(); onDismiss() }}
            title="Dismiss"
          >
            ×
          </button>
        </div>
        <span className="fb-card-excerpt">"{ann.matchedText}"</span>
      </div>

      {/* Idle: show Analyse button */}
      {state.status === 'idle' && (
        <button className="fb-card-analyse-btn" onClick={startAnalysis}>
          Analyse
        </button>
      )}

      {/* Streaming with no text yet: show bouncing dots */}
      {isSpinning && (
        <div className="fb-card-loading">
          <span /><span /><span />
        </div>
      )}

      {/* Streaming or done with text: show markdown body */}
      {hasText && (
        <div
          className="fb-card-analysis chat-message-markdown"
          dangerouslySetInnerHTML={{
            __html: renderMarkdown(state.text, state.status === 'streaming')
          }}
        />
      )}

      {/* Done with a suggestion: show Apply button */}
      {suggestion != null && (
        <button
          className="fb-card-apply"
          onClick={() => applyAnnotation(ann, suggestion)}
        >
          Apply suggestion
        </button>
      )}
    </div>
  )
}

interface ArchiveCardProps {
  ann: TextAnnotation
  onRemove?: () => void
}

function ArchiveCard({ ann, onRemove }: ArchiveCardProps): JSX.Element {
  const typeName = ann.type.replace(/_/g, ' ')
  const status = ann.applied ? 'applied' : 'dismissed'

  return (
    <div
      className={`fb-archive-card fb-archive-card--${status}`}
      style={{ '--badge-color': badgeColor(ann.type) } as React.CSSProperties}
    >
      <div className="fb-archive-card-header">
        <div className="fb-archive-card-badges">
          <span className="fb-card-badge">{typeName}</span>
          <span className={`fb-archive-status fb-archive-status--${status}`}>{status}</span>
        </div>
        {onRemove && (
          <button className="fb-archive-card-dismiss" onClick={onRemove} title="Remove from archive">
            ×
          </button>
        )}
      </div>
      <span className="fb-archive-card-excerpt">"{ann.matchedText}"</span>
      {ann.suggestion && (
        <span className="fb-archive-card-suggestion">→ {ann.suggestion}</span>
      )}
    </div>
  )
}

export function FeedbackPanel(): JSX.Element {
  const {
    annotations,
    annotationsByFile,
    activeFilePath,
    clearAnnotations,
    removeAnnotation,
    clearArchivedAnnotations,
    removeArchivedAnnotation,
  } = useEditorStore()
  const [analyseAll, setAnalyseAll] = useState(false)

  const archivedAnnotations = activeFilePath
    ? (annotationsByFile[activeFilePath]?.annotations ?? []).filter(a => a.applied || a.dismissed)
    : []
  const dismissedCount = archivedAnnotations.filter(a => a.dismissed).length

  // Reset "Analyse all" whenever the annotation set changes (new critique run),
  // so auto-analysis doesn't carry over to fresh results unexpectedly.
  const prevAnnotationsRef = useRef(annotations)
  useEffect(() => {
    if (prevAnnotationsRef.current !== annotations) {
      setAnalyseAll(false)
      prevAnnotationsRef.current = annotations
    }
  }, [annotations])

  function handleClearAll(): void {
    clearAnnotations()
    tooltipAnalysisCache.clear()
  }

  const hasActive = annotations.length > 0
  const hasArchive = archivedAnnotations.length > 0

  if (!hasActive && !hasArchive) {
    return (
      <div className="fb-panel">
        <div className="fb-empty">
          <p>No feedback yet.</p>
          <p>Run a critique from the toolbar to highlight issues in your text.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fb-panel">
      {hasActive && (
        <>
          <div className="fb-toolbar">
            <button
              className="fb-toolbar-btn"
              onClick={() => setAnalyseAll(true)}
              disabled={analyseAll}
              title="Run AI analysis on all highlighted passages"
            >
              Analyse all
            </button>
            <button
              className="fb-toolbar-btn fb-toolbar-btn--clear"
              onClick={handleClearAll}
              title="Archive all highlights"
            >
              Clear all
            </button>
          </div>

          <div className="fb-list">
            {annotations.map(ann => (
              <FeedbackCard
                key={ann.id}
                ann={ann}
                autoAnalyse={analyseAll}
                onDismiss={() => { cancelPendingDismiss(ann.id); removeAnnotation(ann.id); tooltipAnalysisCache.delete(ann.id) }}
              />
            ))}
          </div>
        </>
      )}

      {hasArchive && (
        <details className="fb-archive">
          <summary className="fb-archive-header">
            <span className="fb-archive-title">
              Archive
              <span className="fb-archive-count">{archivedAnnotations.length}</span>
            </span>
            {dismissedCount > 0 && (
              <button
                className="fb-archive-clear-btn"
                onClick={(e) => { e.preventDefault(); clearArchivedAnnotations() }}
                title="Permanently remove all dismissed items"
              >
                Clear dismissed
              </button>
            )}
          </summary>
          <div className="fb-archive-list">
            {archivedAnnotations.map(ann => (
              <ArchiveCard
                key={ann.id}
                ann={ann}
                onRemove={ann.dismissed ? () => removeArchivedAnnotation(ann.id) : undefined}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
