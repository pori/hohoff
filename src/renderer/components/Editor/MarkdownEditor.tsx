import { useEffect, useRef } from 'react'
import { EditorView, Decoration, type DecorationSet, hoverTooltip, keymap } from '@codemirror/view'
import { EditorState, StateField, StateEffect, RangeSetBuilder, Compartment } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useEditorStore } from '../../store/editorStore'
import type { TextAnnotation } from '../../types/editor'
import './Editor.css'

// StateEffect to push new annotations into the editor
export const setAnnotationsEffect = StateEffect.define<TextAnnotation[]>()

// StateField stores the raw annotation array for hover lookup
const rawAnnotationsField = StateField.define<TextAnnotation[]>({
  create: () => [],
  update(annotations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setAnnotationsEffect)) return effect.value
    }
    return annotations
  }
})

// Per-session cache: annotation id → lazily generated analysis text
const tooltipAnalysisCache = new Map<string, string>()

// Hover tooltip — lazily streams a specific AI analysis for the hovered passage
const annotationHoverTooltip = hoverTooltip(
  (view, pos) => {
    const annotations = view.state.field(rawAnnotationsField)
    const ann = annotations.find(a => pos >= a.from && pos <= a.to)
    if (!ann) return null

    return {
      pos,
      above: true,
      create() {
        const dom = document.createElement('div')
        dom.className = 'annotation-tooltip'

        const label = document.createElement('span')
        label.className = 'annotation-tooltip-label'
        label.textContent = ann.type.replace(/_/g, ' ')
        dom.appendChild(label)

        const divider = document.createElement('div')
        divider.className = 'annotation-tooltip-divider'
        dom.appendChild(divider)

        const body = document.createElement('div')
        body.className = 'annotation-tooltip-body'
        dom.appendChild(body)

        let destroyed = false

        function showText(text: string, streaming = false): void {
          body.classList.remove('annotation-tooltip-loading')
          const raw = marked.parse(streaming ? text + ' ▋' : text) as string
          body.innerHTML = DOMPurify.sanitize(raw)
        }

        const cached = tooltipAnalysisCache.get(ann.id)
        if (cached) {
          showText(cached)
        } else {
          body.classList.add('annotation-tooltip-loading')
          body.innerHTML = 'Analysing…'

          const { activeFilePath, activeFileContent } = useEditorStore.getState()
          const typeName = ann.type.replace(/_/g, ' ')
          let accumulated = ''

          const api = (window as unknown as { api?: { streamAIMessage: (p: unknown, cb: (c: string) => void) => Promise<void> } }).api
          if (api?.streamAIMessage) {
            api.streamAIMessage(
              {
                mode: 'chat',
                documentContent: activeFileContent,
                documentPath: activeFilePath ?? '',
                conversationHistory: [],
                userMessage: `This passage was flagged for ${typeName}: "${ann.matchedText}"\n\nIn 1–2 sentences explain specifically what the issue is in this exact passage, then give a direct rewrite of just this passage. Be concise and specific—no generic advice.`
              },
              (chunk: string) => {
                if (destroyed) return
                accumulated += chunk
                showText(accumulated, true)
              }
            ).then(() => {
              if (destroyed) return
              const result = accumulated || ann.message
              tooltipAnalysisCache.set(ann.id, result)
              showText(result)
            }).catch(() => {
              if (!destroyed) showText(ann.message)
            })
          } else {
            showText(ann.message)
          }
        }

        return { dom, destroy() { destroyed = true } }
      }
    }
  },
  { hoverTime: 500 }
)

// StateField tracks the decoration set derived from annotations
const annotationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(setAnnotationsEffect)) {
        const builder = new RangeSetBuilder<Decoration>()
        const sorted = [...effect.value].sort((a, b) => a.from - b.from)
        for (const ann of sorted) {
          const docLen = tr.newDoc.length
          const from = Math.max(0, Math.min(ann.from, docLen))
          const to = Math.max(from, Math.min(ann.to, docLen))
          if (from < to) {
            builder.add(
              from,
              to,
              Decoration.mark({
                class: `annotation annotation-${ann.type}`,
                attributes: { 'data-id': ann.id }
              })
            )
          }
        }
        return builder.finish()
      }
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f)
})

const themeCompartment = new Compartment()

function buildTheme(fontSize: number, dark: boolean): ReturnType<typeof EditorView.theme> {
  return EditorView.theme(
  {
    '&': {
      height: '100%',
      fontSize: `${fontSize}px`,
      backgroundColor: 'transparent',
      color: 'var(--text-primary)'
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-serif)',
      lineHeight: '1.8',
      overflow: 'auto'
    },
    '.cm-content': {
      padding: '16px 20px',
      maxWidth: '740px',
      margin: '0 auto',
      caretColor: 'var(--accent)'
    },
    '.cm-cursor': { borderLeftColor: 'var(--accent)' },
    '.cm-selectionBackground': { backgroundColor: 'var(--active-bg)' },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--active-bg)' },
    '.cm-line': { padding: '0', marginBottom: '6px' },
    '.cm-gutters': { display: 'none' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },

    // Markdown heading styles
    '.tok-heading': { fontWeight: '700', color: 'var(--heading-color)' },
    '.tok-heading1': { fontSize: '1.4em' },
    '.tok-heading2': { fontSize: '1.2em' },
    '.tok-emphasis': { fontStyle: 'italic' },
    '.tok-strong': { fontWeight: '700' },

    // Annotation highlight styles
    '.annotation-passive_voice': {
      backgroundColor: 'rgba(255, 200, 0, 0.18)',
      borderBottom: '2px solid rgba(255, 200, 0, 0.7)',
      borderRadius: '2px'
    },
    '.annotation-consistency': {
      backgroundColor: 'rgba(220, 80, 80, 0.18)',
      borderBottom: '2px solid rgba(220, 80, 80, 0.7)',
      borderRadius: '2px'
    },
    '.annotation-style': {
      backgroundColor: 'rgba(80, 160, 255, 0.18)',
      borderBottom: '2px solid rgba(80, 160, 255, 0.7)',
      borderRadius: '2px'
    },
    '.annotation-critique': {
      backgroundColor: 'rgba(160, 80, 220, 0.18)',
      borderBottom: '2px solid rgba(160, 80, 220, 0.7)',
      borderRadius: '2px'
    }
  },
  { dark }
  )
}

export function MarkdownEditor(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const { activeFilePath, activeFileContent, setContent, annotations, fontSize, theme } = useEditorStore()

  // Initialize CodeMirror once
  useEffect(() => {
    if (!containerRef.current) return

    const view = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle),
          rawAnnotationsField,
          annotationField,
          annotationHoverTooltip,
          themeCompartment.of(buildTheme(fontSize, theme === 'dark')),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              setContent(update.state.doc.toString())
            }
          })
        ]
      }),
      parent: containerRef.current
    })

    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // When the active file changes, replace editor content
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== activeFileContent) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: activeFileContent }
      })
      // Scroll to top on file switch
      view.dispatch({ selection: { anchor: 0 } })
      view.scrollDOM.scrollTop = 0
    }
  }, [activeFilePath]) // Only sync on file switch

  // Push annotation decorations into CodeMirror
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: setAnnotationsEffect.of(annotations) })
  }, [annotations])

  // Reconfigure theme when font size or colour theme changes
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: themeCompartment.reconfigure(buildTheme(fontSize, theme === 'dark')) })
  }, [fontSize, theme])

  return (
    <div className="editor-container">
      {!activeFilePath && (
        <div className="editor-empty">
          <p>Select a chapter from the sidebar to begin editing.</p>
          <p className="editor-empty-hint">Your draft files will never be modified without saving (Cmd+S).</p>
        </div>
      )}
      <div ref={containerRef} className="codemirror-host" />
    </div>
  )
}
