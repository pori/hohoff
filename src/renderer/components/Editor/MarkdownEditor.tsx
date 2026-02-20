import { useEffect, useRef } from 'react'
import { EditorView, Decoration, type DecorationSet } from '@codemirror/view'
import { EditorState, StateField, StateEffect, RangeSetBuilder } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands'
import { keymap } from '@codemirror/view'
import { useEditorStore } from '../../store/editorStore'
import type { TextAnnotation } from '../../types/editor'
import './Editor.css'

// StateEffect to push new annotations into the editor
export const setAnnotationsEffect = StateEffect.define<TextAnnotation[]>()

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
                attributes: { 'data-id': ann.id, title: ann.message }
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

// Dark gothic theme for CodeMirror
const hohoffTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      fontSize: '15px',
      backgroundColor: 'transparent',
      color: 'var(--text-primary)'
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-serif)',
      lineHeight: '1.8',
      overflow: 'auto'
    },
    '.cm-content': {
      padding: '24px 32px',
      maxWidth: '740px',
      margin: '0 auto',
      caretColor: 'var(--accent)'
    },
    '.cm-cursor': { borderLeftColor: 'var(--accent)' },
    '.cm-selectionBackground': { backgroundColor: 'rgba(167,139,95,0.2)' },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(167,139,95,0.3)' },
    '.cm-line': { padding: '0' },
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
    }
  },
  { dark: true }
)

export function MarkdownEditor(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const { activeFilePath, activeFileContent, setContent, annotations } = useEditorStore()

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
          annotationField,
          hohoffTheme,
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
