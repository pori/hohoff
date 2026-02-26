import { useEffect, useRef, useState } from 'react'
import { EditorView, Decoration, type DecorationSet, hoverTooltip, keymap } from '@codemirror/view'
import { EditorState, StateField, StateEffect, RangeSetBuilder, Compartment, Transaction } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { history, defaultKeymap, historyKeymap, invertedEffects, selectAll } from '@codemirror/commands'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useEditorStore } from '../../store/editorStore'
import type { TextAnnotation } from '../../types/editor'
import { ContextMenu } from '../FileTree/ContextMenu'
import type { MenuItem } from '../FileTree/ContextMenu'
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

// Per-session cache: annotation id → { text, suggestion extracted from blockquote }
export const tooltipAnalysisCache = new Map<string, { text: string; suggestion: string | null }>()

// Extract the first blockquote from a markdown string — used as the applicable rewrite
function extractBlockquote(md: string): string | null {
  const lines = md.split('\n')
  const bqLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('> ')) bqLines.push(line.slice(2))
    else if (line === '>') bqLines.push('')
  }
  const text = bqLines.join(' ').trim()
  return text || null
}

// Shared analysis function — used by both the hover tooltip and FeedbackPanel.
// Returns a cancel function; call it to stop receiving onUpdate callbacks.
export function analyseAnnotation(
  ann: TextAnnotation,
  onUpdate: (text: string, streaming: boolean, suggestion: string | null) => void
): () => void {
  const cached = tooltipAnalysisCache.get(ann.id)
  if (cached) {
    onUpdate(cached.text, false, cached.suggestion)
    return () => {}
  }

  let cancelled = false
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
        userMessage: `This passage was flagged for ${typeName}: "${ann.matchedText}"\n\nIn 1–2 sentences explain the specific issue, then provide a direct rewrite in a markdown blockquote like this:\n\n> Rewritten passage here.\n\nBe specific to this exact text—no generic advice.`
      },
      (chunk: string) => {
        if (cancelled) return
        accumulated += chunk
        onUpdate(accumulated, true, null)
      }
    ).then(() => {
      if (cancelled) return
      const text = accumulated || ann.message
      const suggestion = extractBlockquote(text) ?? ann.suggestion ?? null
      tooltipAnalysisCache.set(ann.id, { text, suggestion })
      onUpdate(text, false, suggestion)
    }).catch(() => {
      if (!cancelled) onUpdate(ann.message, false, ann.suggestion ?? null)
    })
  } else {
    const suggestion = ann.suggestion ?? null
    tooltipAnalysisCache.set(ann.id, { text: ann.message, suggestion })
    onUpdate(ann.message, false, suggestion)
  }

  return () => { cancelled = true }
}

// Exported module-level reference so FeedbackPanel can access the live EditorView
// without prop-drilling. Set in the mount effect, nulled on cleanup.
export let currentEditorView: EditorView | null = null

// Scroll the editor to an annotation and place the cursor there
export function scrollToAnnotation(ann: TextAnnotation): void {
  const view = currentEditorView
  if (!view) return
  view.dispatch({
    selection: { anchor: ann.from },
    effects: EditorView.scrollIntoView(ann.from, { y: 'center' })
  })
}

// Apply a suggestion to the document and remove that annotation
export function applyAnnotation(ann: TextAnnotation, suggestion: string): void {
  const view = currentEditorView
  if (!view) return
  const { annotations: anns, setAnnotations } = useEditorStore.getState()
  const changeSpec = { from: ann.from, to: ann.to, insert: suggestion }
  // Map surviving annotation positions through the text change so
  // their from/to reflect the new document offsets.
  const changeSet = view.state.changes(changeSpec)
  const remaining = anns
    .filter(a => a.id !== ann.id)
    .map(a => ({ ...a, from: changeSet.mapPos(a.from), to: changeSet.mapPos(a.to) }))
  // Combine text replacement + annotation update in one transaction
  // so CM history treats them as a single undoable unit.
  view.dispatch({
    changes: changeSpec,
    effects: setAnnotationsEffect.of(remaining)
  })
  setAnnotations(remaining)
  tooltipAnalysisCache.delete(ann.id)
}

// Hover tooltip — lazily streams a specific AI analysis for the hovered passage
const annotationHoverTooltip = hoverTooltip(
  (view, pos) => {
    const annotations = view.state.field(rawAnnotationsField)
    const found = annotations.find(a => pos >= a.from && pos <= a.to)
    if (!found) return null
    // Capture in a new const so TypeScript preserves the non-undefined type
    // across the nested create() closure without requiring non-null assertions.
    const ann: TextAnnotation = found

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

        function showText(text: string, streaming = false): void {
          body.classList.remove('annotation-tooltip-loading')
          const raw = marked.parse(streaming ? text + ' ▋' : text) as string
          body.innerHTML = DOMPurify.sanitize(raw)
        }

        function showApplyButton(suggestion: string): void {
          const btnDivider = document.createElement('div')
          btnDivider.className = 'annotation-tooltip-divider'
          dom.appendChild(btnDivider)

          const btn = document.createElement('button')
          btn.className = 'annotation-tooltip-apply'
          btn.textContent = 'Apply suggestion'
          btn.addEventListener('click', () => {
            applyAnnotation(ann, suggestion)
          })
          dom.appendChild(btn)
        }

        body.classList.add('annotation-tooltip-loading')
        body.innerHTML = 'Analysing…'

        const cancelAnalysis = analyseAnnotation(ann, (text, streaming, suggestion) => {
          showText(text, streaming)
          if (!streaming && suggestion && !dom.querySelector('.annotation-tooltip-apply')) {
            showApplyButton(suggestion)
          }
        })

        return { dom, destroy() { cancelAnalysis() } }
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

// Teach CM's undo/redo history about annotation state so that Cmd+Z after
// an Apply also restores the highlight. For every transaction that carries a
// setAnnotationsEffect we record the *previous* annotation list as the
// inverse effect; CM history replays it on undo.
const annotationHistory = invertedEffects.of(tr => {
  // Only track annotation changes that accompany a document edit (i.e. an
  // Apply). External updates — critique results loading, store clears — have
  // no doc change and must NOT enter the undo stack, otherwise Undo removes
  // highlights before touching any text.
  if (tr.docChanged && tr.effects.some(e => e.is(setAnnotationsEffect))) {
    const before = tr.startState.field(rawAnnotationsField)
    return [setAnnotationsEffect.of(before)]
  }
  return []
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
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [hasSelection, setHasSelection] = useState(false)
  const { activeFilePath, activeFileContent, setContent, annotations, fontSize, theme, scrollPositions } = useEditorStore()

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
          annotationHistory,
          themeCompartment.of(buildTheme(fontSize, theme === 'dark')),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              setContent(update.state.doc.toString())
            }
            if (update.selectionSet) {
              const { from, to } = update.state.selection.main
              setHasSelection(from !== to)
            }
            // When the user Cmd+Z's through an Apply, invertedEffects fires a
            // setAnnotationsEffect restoring the old list inside CM. Sync that
            // back to Zustand so the React decoration effect also reflects it.
            const hasUndoRedo = update.transactions.some(
              tr => tr.isUserEvent('undo') || tr.isUserEvent('redo')
            )
            if (hasUndoRedo) {
              const prev = update.startState.field(rawAnnotationsField)
              const curr = update.state.field(rawAnnotationsField)
              if (prev !== curr) {
                useEditorStore.getState().setAnnotations(curr)
              }
            }
          })
        ]
      }),
      parent: containerRef.current
    })

    viewRef.current = view
    currentEditorView = view

    // Track scroll position — debounced so we don't thrash IPC on every pixel
    let scrollTimer: ReturnType<typeof setTimeout> | null = null
    const onScroll = (): void => {
      if (scrollTimer) clearTimeout(scrollTimer)
      scrollTimer = setTimeout(() => {
        const { activeFilePath: fp, setScrollPosition: save } = useEditorStore.getState()
        if (fp) save(fp, view.scrollDOM.scrollTop)
      }, 300)
    }
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true })

    // Expose view + undo for dev-mode testing (stripped in production)
    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>
      w.__cmView = view
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      import('@codemirror/commands').then(({ undo, redo }) => {
        w.__cmUndo = () => undo(view)
        w.__cmRedo = () => redo(view)
      })
    }
    return () => {
      view.scrollDOM.removeEventListener('scroll', onScroll)
      if (scrollTimer) clearTimeout(scrollTimer)
      view.destroy()
      viewRef.current = null
      currentEditorView = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // When the active file changes, replace editor content and restore scroll
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== activeFileContent) {
      // Mark the file-load as non-undoable: loading a file should never
      // appear in the undo stack, so Cmd+Z can't empty the document.
      view.dispatch({
        changes: { from: 0, to: current.length, insert: activeFileContent },
        annotations: Transaction.addToHistory.of(false)
      })
      view.dispatch({ selection: { anchor: 0 } })
      // Restore saved scroll position, or go to top for new files
      const savedScroll = activeFilePath ? scrollPositions[activeFilePath] ?? 0 : 0
      // Defer scroll restoration so CodeMirror finishes laying out the new content
      requestAnimationFrame(() => {
        view.scrollDOM.scrollTop = savedScroll
      })
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

  function handleContextMenu(e: React.MouseEvent): void {
    if (!activeFilePath) return
    e.preventDefault()
    const view = viewRef.current
    if (view) {
      const { from, to } = view.state.selection.main
      setHasSelection(from !== to)
    }
    setMenuPos({ x: e.clientX, y: e.clientY })
  }

  const editorMenuItems: (MenuItem | 'separator')[] = [
    {
      label: 'Cut',
      disabled: !hasSelection,
      action: () => {
        const view = viewRef.current
        if (!view) return
        const { from, to } = view.state.selection.main
        if (from === to) return
        navigator.clipboard.writeText(view.state.sliceDoc(from, to)).catch(console.error)
        view.dispatch({ changes: { from, to, insert: '' } })
        view.focus()
      }
    },
    {
      label: 'Copy',
      disabled: !hasSelection,
      action: () => {
        const view = viewRef.current
        if (!view) return
        const { from, to } = view.state.selection.main
        if (from === to) return
        navigator.clipboard.writeText(view.state.sliceDoc(from, to)).catch(console.error)
        view.focus()
      }
    },
    {
      label: 'Paste',
      action: () => {
        const view = viewRef.current
        if (!view) return
        navigator.clipboard.readText().then((text) => {
          const { from, to } = view.state.selection.main
          view.dispatch({ changes: { from, to, insert: text } })
          view.focus()
        }).catch(console.error)
      }
    },
    'separator',
    {
      label: 'Select All',
      action: () => {
        const view = viewRef.current
        if (!view) return
        selectAll(view)
        view.focus()
      }
    }
  ]

  return (
    <div className="editor-container" onContextMenu={handleContextMenu}>
      {!activeFilePath && (
        <div className="editor-empty">
          <p>Select a chapter from the sidebar to begin editing.</p>
          <p className="editor-empty-hint">Your draft files will never be modified without saving (Cmd+S).</p>
        </div>
      )}
      <div ref={containerRef} className="codemirror-host" />
      {menuPos && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          items={editorMenuItems}
          onClose={() => setMenuPos(null)}
        />
      )}
    </div>
  )
}
