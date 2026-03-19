import { useEffect, useRef, useState } from 'react'
import { EditorView, Decoration, type DecorationSet, hoverTooltip, keymap, ViewPlugin, WidgetType, type ViewUpdate } from '@codemirror/view'
import { EditorState, EditorSelection, StateField, StateEffect, Annotation, RangeSetBuilder, Compartment, Transaction } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting, defaultHighlightStyle, syntaxTree } from '@codemirror/language'
import { history, defaultKeymap, historyKeymap, invertedEffects, selectAll, indentLess } from '@codemirror/commands'
import { search, searchKeymap, openSearchPanel } from '@codemirror/search'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useEditorStore } from '../../store/editorStore'
import type { TextAnnotation } from '../../types/editor'
import { reanchorAnnotations } from '../../utils/annotationParser'
import { ContextMenu } from '../FileTree/ContextMenu'
import type { MenuItem } from '../FileTree/ContextMenu'
import './Editor.css'

// StateEffect to push new annotations into the editor
export const setAnnotationsEffect = StateEffect.define<TextAnnotation[]>()

// Annotation tag that marks an auto-dismiss transaction so annotationHistory
// records its inverse, making the dismissal undoable with Cmd+Z.
const userDismissAnnotation = Annotation.define<boolean>()

// StateField stores the raw annotation array for hover lookup.
// Positions are mapped through every document change so the field always
// reflects where annotations actually are in the current document.
// Zero-width entries (from === to after a deletion) are intentionally kept:
// if the user cuts text and pastes it back at the same spot, the position
// expands and the decoration reappears automatically.
const rawAnnotationsField = StateField.define<TextAnnotation[]>({
  create: () => [],
  update(annotations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setAnnotationsEffect)) return effect.value
    }
    if (tr.docChanged && annotations.length > 0) {
      const oldLen = tr.changes.length
      return annotations.map(a => ({
        ...a,
        from: tr.changes.mapPos(Math.min(a.from, oldLen), -1),
        to:   tr.changes.mapPos(Math.min(a.to,   oldLen),  1)
      }))
    }
    return annotations
  }
})

// Per-session cache: annotation id → { text, suggestion extracted from blockquote }
export const tooltipAnalysisCache = new Map<string, { text: string; suggestion: string | null }>()

// Debounced auto-dismissal when the user edits text inside a highlighted range.
// Exported so FeedbackPanel can cancel a pending timer on manual dismiss.
const EDIT_DISMISS_MS = 1200
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function cancelPendingDismiss(id: string): void {
  const t = dismissTimers.get(id)
  if (t !== undefined) { clearTimeout(t); dismissTimers.delete(id) }
}

function schedulePendingDismiss(id: string): void {
  const existing = dismissTimers.get(id)
  if (existing !== undefined) clearTimeout(existing)
  dismissTimers.set(id, setTimeout(() => {
    dismissTimers.delete(id)
    tooltipAnalysisCache.delete(id)
    const view = currentEditorView
    if (!view) {
      // No editor mounted — fall back to direct store update (not undoable)
      useEditorStore.getState().removeAnnotation(id)
      return
    }
    // Dispatch a tagged CM transaction so annotationHistory records the inverse
    // and the dismissal can be undone with Cmd+Z.
    const remaining = view.state.field(rawAnnotationsField).filter(a => a.id !== id)
    view.dispatch({
      effects: setAnnotationsEffect.of(remaining),
      annotations: [userDismissAnnotation.of(true)]
    })
    // Store sync is handled by the updateListener detecting userDismissAnnotation.
  }, EDIT_DISMISS_MS))
}

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
  const cached = tooltipAnalysisCache.get(ann.id) ?? ann.analysisCache ?? null
  if (cached) {
    // Warm the in-memory cache so subsequent calls this session are instant
    if (!tooltipAnalysisCache.has(ann.id)) tooltipAnalysisCache.set(ann.id, cached)
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
        userMessage: ann.autoAnalyse
          ? `Please provide editorial feedback on this selected passage: "${ann.matchedText}"\n\nIn 1–2 sentences, identify the most important issue or opportunity for improvement, then provide a suggested rewrite in a markdown blockquote:\n\n> Rewritten version here.\n\nBe specific to this exact text.`
          : `This passage was flagged for ${typeName}: "${ann.matchedText}"\n\nIn 1–2 sentences explain the specific issue, then provide a direct rewrite in a markdown blockquote like this:\n\n> Rewritten passage here.\n\nBe specific to this exact text—no generic advice.`
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
      useEditorStore.getState().setAnnotationAnalysis(ann.id, { text, suggestion })
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

// Scroll the editor to an annotation and place the cursor there.
// Always resolves the position from CM's rawAnnotationsField so that edits
// made since the annotation was created don't send the cursor to a stale offset.
export function scrollToAnnotation(ann: TextAnnotation): void {
  const view = currentEditorView
  if (!view) return
  const tracked = view.state.field(rawAnnotationsField).find(a => a.id === ann.id) ?? ann
  view.dispatch({
    selection: { anchor: tracked.from },
    effects: EditorView.scrollIntoView(tracked.from, { y: 'center' })
  })
}

// Apply a suggestion to the document and mark that annotation as applied.
// Always resolves positions from CM's rawAnnotationsField so that edits made
// since the annotation was created don't apply the change at a stale offset,
// and so surviving annotation positions are also remapped from their current
// (post-edit) locations rather than the stale values held by the store.
export function applyAnnotation(ann: TextAnnotation, suggestion: string): void {
  const view = currentEditorView
  if (!view) return
  const { markAnnotationApplied } = useEditorStore.getState()
  const cmAnnotations = view.state.field(rawAnnotationsField)
  const tracked = cmAnnotations.find(a => a.id === ann.id)
  if (!tracked) return
  const changeSpec = { from: tracked.from, to: tracked.to, insert: suggestion }
  // Map surviving annotation positions through the text change so
  // their from/to reflect the new document offsets.
  const changeSet = view.state.changes(changeSpec)
  const remaining = cmAnnotations
    .filter(a => a.id !== ann.id)
    .map(a => ({ ...a, from: changeSet.mapPos(a.from), to: changeSet.mapPos(a.to) }))
  // Combine text replacement + annotation update in one transaction
  // so CM history treats them as a single undoable unit.
  view.dispatch({
    changes: changeSpec,
    effects: setAnnotationsEffect.of(remaining)
  })
  // Mark as applied in annotationsByFile (preserves it for chat history) and
  // remove from the active annotations list.
  markAnnotationApplied(ann.id)
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

    // User comments: show static tooltip with the comment text — no AI streaming
    if (ann.type === 'user_comment') {
      return {
        pos,
        end: ann.to,
        above: true,
        create() {
          const dom = document.createElement('div')
          dom.className = 'annotation-tooltip'
          dom.addEventListener('mousemove', (e) => e.stopPropagation())
          const label = document.createElement('span')
          label.className = 'annotation-tooltip-label'
          label.textContent = 'Your comment'
          dom.appendChild(label)
          const dismissBtn = document.createElement('button')
          dismissBtn.className = 'annotation-tooltip-dismiss'
          dismissBtn.title = 'Dismiss'
          dismissBtn.textContent = '×'
          dismissBtn.addEventListener('click', () => {
            useEditorStore.getState().removeAnnotation(ann.id)
          })
          dom.appendChild(dismissBtn)
          const divider = document.createElement('div')
          divider.className = 'annotation-tooltip-divider'
          dom.appendChild(divider)
          const body = document.createElement('div')
          body.className = 'annotation-tooltip-body'
          body.textContent = ann.comment ?? ann.message
          dom.appendChild(body)
          const bridge = document.createElement('div')
          bridge.className = 'cm-tooltip-arrow'
          dom.appendChild(bridge)
          return { dom, destroy() {} }
        }
      }
    }

    return {
      pos,
      end: ann.to,
      above: true,
      create() {
        const dom = document.createElement('div')
        dom.className = 'annotation-tooltip'
        dom.addEventListener('mousemove', (e) => e.stopPropagation())

        const label = document.createElement('span')
        label.className = 'annotation-tooltip-label'
        label.textContent = ann.type.replace(/_/g, ' ')
        dom.appendChild(label)

        const dismissBtn = document.createElement('button')
        dismissBtn.className = 'annotation-tooltip-dismiss'
        dismissBtn.title = 'Dismiss'
        dismissBtn.textContent = '×'
        dismissBtn.addEventListener('click', () => {
          useEditorStore.getState().removeAnnotation(ann.id)
        })
        dom.appendChild(dismissBtn)

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
          if (!streaming) {
            window.dispatchEvent(new CustomEvent('annotation-cached', { detail: { id: ann.id } }))
            if (suggestion && !dom.querySelector('.annotation-tooltip-apply')) {
              showApplyButton(suggestion)
            }
          }
        })

        const bridge = document.createElement('div')
        bridge.className = 'cm-tooltip-arrow'
        dom.appendChild(bridge)

        return { dom, destroy() { cancelAnalysis() } }
      }
    }
  },
  { hoverTime: 500 }
)

// Build a DecorationSet from an annotation list, clamped to docLen.
function buildDecoSet(annotations: TextAnnotation[], docLen: number): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const sorted = [...annotations].sort((a, b) => a.from - b.from)
  for (const ann of sorted) {
    const from = Math.max(0, Math.min(ann.from, docLen))
    const to   = Math.max(from, Math.min(ann.to,   docLen))
    if (from < to) {
      builder.add(from, to, Decoration.mark({
        class: `annotation annotation-${ann.type}`,
        attributes: { 'data-id': ann.id }
      }))
    }
  }
  return builder.finish()
}

// StateField tracks the decoration set derived from annotations.
// Rebuilds from rawAnnotationsField on every doc change (not deco.map) so that
// position-mapped highlights update immediately, and a decoration whose text
// was cut and pasted back at the same spot reappears without any extra action.
const annotationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    if (tr.docChanged || tr.effects.some(e => e.is(setAnnotationsEffect))) {
      return buildDecoSet(tr.state.field(rawAnnotationsField), tr.newDoc.length)
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f)
})

// Teach CM's undo/redo history about annotation state so Cmd+Z can restore
// highlights. Records the previous annotation list as the inverse effect for:
//   • Apply suggestion  (docChanged + setAnnotationsEffect)
//   • Edit-triggered auto-dismiss  (tagged with userDismissAnnotation)
// External updates (critique loads, store clears) have neither flag and must
// NOT enter the undo stack or Undo would remove highlights unexpectedly.
const annotationHistory = invertedEffects.of(tr => {
  const isApply = tr.docChanged && tr.effects.some(e => e.is(setAnnotationsEffect))
  const isAutoDismiss = tr.annotation(userDismissAnnotation) === true
  if (isApply || isAutoDismiss) {
    const before = tr.startState.field(rawAnnotationsField)
    return [setAnnotationsEffect.of(before)]
  }
  return []
})

const themeCompartment = new Compartment()

// Horizontal rule widget — replaces `---` lines with a visual scene-break line
class HrWidget extends WidgetType {
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-hr-widget'
    return el
  }
  ignoreEvent() { return false }
}

function buildHrDecos(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.name === 'HorizontalRule') {
        builder.add(node.from, node.to, Decoration.replace({ widget: new HrWidget() }))
      }
    }
  })
  return builder.finish()
}

const hrPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = buildHrDecos(view) }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildHrDecos(update.view)
      }
    }
  },
  { decorations: v => v.decorations }
)

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
    '.cm-line': { paddingBottom: '14px' },
    '.cm-gutters': { display: 'none' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },

    // Markdown heading styles
    '.tok-heading': { fontWeight: '700', color: 'var(--heading-color)' },
    '.tok-heading1': { fontSize: '1.4em' },
    '.tok-heading2': { fontSize: '1.2em' },
    '.tok-emphasis': { fontStyle: 'italic' },
    '.tok-strong': { fontWeight: '700' },
    '.cm-hr-widget': {
      display: 'inline-block',
      width: '100%',
      height: '0',
      borderTop: '1px solid var(--border)',
      opacity: '0.45',
      verticalAlign: 'middle',
    },

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
    '.annotation-show_tell': {
      backgroundColor: 'rgba(255, 140, 30, 0.18)',
      borderBottom: '2px solid rgba(255, 140, 30, 0.7)',
      borderRadius: '2px'
    },
    '.annotation-critique': {
      backgroundColor: 'rgba(160, 80, 220, 0.18)',
      borderBottom: '2px solid rgba(160, 80, 220, 0.7)',
      borderRadius: '2px'
    },
    '.annotation-custom': {
      backgroundColor: 'rgba(30, 200, 150, 0.15)',
      borderBottom: '2px solid rgba(30, 200, 150, 0.7)',
      borderRadius: '2px'
    },
    '.annotation-user_comment': {
      backgroundColor: 'rgba(240, 100, 180, 0.15)',
      borderBottom: '2px solid rgba(240, 100, 180, 0.65)',
      borderRadius: '2px'
    }
  },
  { dark }
  )
}

// --- Markdown formatting helpers ---

function wrapOrUnwrap(view: EditorView, marker: string): boolean {
  const { state } = view
  const changes = state.changeByRange(range => {
    const selected = state.sliceDoc(range.from, range.to)
    const m = marker.length

    // Case 1: selection itself includes the markers (e.g. user selected "**bold**")
    if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= m * 2 + 1) {
      const inner = selected.slice(m, selected.length - m)
      return {
        changes: { from: range.from, to: range.to, insert: inner },
        range: EditorSelection.range(range.from, range.from + inner.length)
      }
    }

    // Case 2: markers sit just outside the selection — happens after a wrap when
    // the selection is left on the inner text (e.g. cursor on "bold" inside "**bold**")
    const before = range.from >= m ? state.sliceDoc(range.from - m, range.from) : ''
    const after = state.sliceDoc(range.to, range.to + m)
    if (before === marker && after === marker) {
      return {
        changes: [
          { from: range.from - m, to: range.from, insert: '' },
          { from: range.to, to: range.to + m, insert: '' }
        ],
        range: EditorSelection.range(range.from - m, range.to - m)
      }
    }

    // Case 3: not wrapped — wrap it
    const wrapped = marker + selected + marker
    return {
      changes: { from: range.from, to: range.to, insert: wrapped },
      range: EditorSelection.range(range.from + m, range.from + m + selected.length)
    }
  })
  view.dispatch(state.update(changes, { userEvent: 'input' }))
  return true
}

function toggleLinePrefix(view: EditorView, prefix: string): boolean {
  const { state } = view
  const changes = state.changeByRange(range => {
    const lineFrom = state.doc.lineAt(range.from)
    const lineTo = state.doc.lineAt(range.to)
    const insertions: { from: number; to: number; insert: string }[] = []
    let removing = true
    for (let ln = lineFrom.number; ln <= lineTo.number; ln++) {
      if (!state.doc.line(ln).text.startsWith(prefix)) { removing = false; break }
    }
    for (let ln = lineFrom.number; ln <= lineTo.number; ln++) {
      const line = state.doc.line(ln)
      if (removing) {
        insertions.push({ from: line.from, to: line.from + prefix.length, insert: '' })
      } else if (!line.text.startsWith(prefix)) {
        insertions.push({ from: line.from, to: line.from, insert: prefix })
      }
    }
    return { changes: insertions, range }
  })
  view.dispatch(state.update(changes, { userEvent: 'input' }))
  return true
}

function setHeading(view: EditorView, level: number): boolean {
  const { state } = view
  const prefix = '#'.repeat(level) + ' '
  const changes = state.changeByRange(range => {
    const lineFrom = state.doc.lineAt(range.from)
    const lineTo = state.doc.lineAt(range.to)
    const insertions: { from: number; to: number; insert: string }[] = []
    for (let ln = lineFrom.number; ln <= lineTo.number; ln++) {
      const line = state.doc.line(ln)
      const existingMatch = line.text.match(/^(#{1,6} )/)
      const existingLen = existingMatch ? existingMatch[0].length : 0
      if (line.text.startsWith(prefix)) {
        insertions.push({ from: line.from, to: line.from + prefix.length, insert: '' })
      } else {
        insertions.push({ from: line.from, to: line.from + existingLen, insert: prefix })
      }
    }
    return { changes: insertions, range }
  })
  view.dispatch(state.update(changes, { userEvent: 'input' }))
  return true
}

function insertLink(view: EditorView): boolean {
  const { state } = view
  const changes = state.changeByRange(range => {
    const selected = state.sliceDoc(range.from, range.to)
    const insert = `[${selected}]()`
    const cursorPos = range.from + selected.length + 3 // inside ()
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(cursorPos)
    }
  })
  view.dispatch(state.update(changes, { userEvent: 'input' }))
  return true
}

export function MarkdownEditor(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [hasSelection, setHasSelection] = useState(false)
  const [pendingComment, setPendingComment] = useState<{ from: number; to: number; text: string } | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const { activeFilePath, activeFileContent, setContent, annotations, fontSize, theme, scrollPositions, pendingScrollToLine, clearPendingScrollToLine } = useEditorStore()

  function saveComment(): void {
    if (!pendingComment || !commentDraft.trim()) return
    const annotation: TextAnnotation = {
      id: `user-comment-${Date.now()}`,
      type: 'user_comment',
      from: pendingComment.from,
      to: pendingComment.to,
      matchedText: pendingComment.text,
      message: commentDraft.trim(),
      comment: commentDraft.trim(),
    }
    const store = useEditorStore.getState()
    store.setAnnotations([...store.annotations, annotation])
    store.setRightPanelTab('feedback')
    setPendingComment(null)
    setCommentDraft('')
  }

  // Initialize CodeMirror once
  useEffect(() => {
    if (!containerRef.current) return

    const view = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [
          history(),
          search({ top: true }),
          keymap.of([
            {
              key: 'Tab',
              run: (view) => {
                view.dispatch(view.state.replaceSelection('  '))
                return true
              }
            },
            { key: 'Shift-Tab', run: indentLess },
            { key: 'Mod-b', run: (view) => wrapOrUnwrap(view, '**') },
            { key: 'Mod-i', run: (view) => wrapOrUnwrap(view, '*') },
            { key: 'Mod-Shift-s', run: (view) => wrapOrUnwrap(view, '~~') },
            { key: 'Mod-e', run: (view) => wrapOrUnwrap(view, '`') },
            { key: 'Mod-k', run: insertLink },
            { key: 'Mod-Shift-.', run: (view) => toggleLinePrefix(view, '> ') },
            { key: 'Mod-1', run: (view) => setHeading(view, 1) },
            { key: 'Mod-2', run: (view) => setHeading(view, 2) },
            { key: 'Mod-3', run: (view) => setHeading(view, 3) },
            ...searchKeymap,
            ...defaultKeymap,
            ...historyKeymap
          ]),
          markdown({ extensions: [{ remove: ['SetextHeading'] }] }),
          syntaxHighlighting(defaultHighlightStyle),
          rawAnnotationsField,
          annotationField,
          annotationHoverTooltip,
          annotationHistory,
          hrPlugin,
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
              // User is reverting edits — cancel any pending auto-dismissals so
              // restored highlights aren't immediately removed.
              dismissTimers.forEach((_, id) => cancelPendingDismiss(id))
              const prev = update.startState.field(rawAnnotationsField)
              const curr = update.state.field(rawAnnotationsField)
              if (prev !== curr) {
                useEditorStore.getState().setAnnotations(curr)
              }
              return
            }

            // When the debounce timer fires it dispatches a tagged CM transaction
            // (no doc change). Sync the resulting annotation list to the store so
            // the feedback panel reflects the dismissal immediately.
            if (update.transactions.some(tr => tr.annotation(userDismissAnnotation) === true)) {
              useEditorStore.getState().setAnnotations(update.state.field(rawAnnotationsField))
              return
            }

            // Auto-dismiss annotations whose highlighted text the user edits.
            // We check the pre-edit annotation positions (startState) against
            // each changed range reported by the transaction.
            if (update.docChanged) {
              const preAnnotations = update.startState.field(rawAnnotationsField)
              if (preAnnotations.length > 0) {
                for (const tr of update.transactions) {
                  if (!tr.docChanged) continue
                  // Skip non-user events such as file loads (addToHistory=false).
                  if (tr.annotation(Transaction.addToHistory) === false) continue
                  tr.changes.iterChangedRanges((fromA, toA) => {
                    for (const ann of preAnnotations) {
                      if (fromA < ann.to && toA > ann.from) {
                        schedulePendingDismiss(ann.id)
                      }
                    }
                  })
                }
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

  // Push annotation decorations into CodeMirror.
  // Re-anchors positions against current doc content first so that stale
  // from/to offsets (from session restore or external file edits) are corrected
  // before they reach CM. Then merges with CM-tracked positions so that live
  // mapPos updates are never overwritten for already-tracked annotations.
  // Marked addToHistory.of(false) so this sync dispatch never creates an undo
  // step — only Apply and tagged auto-dismissals should be undoable.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const content = view.state.doc.toString()
    const docLen = content.length
    const reanchored = reanchorAnnotations(annotations, content)
    const trackedById = new Map(view.state.field(rawAnnotationsField).map(a => [a.id, a]))
    const toDispatch = reanchored.map(a => {
      const tracked = trackedById.get(a.id)
      return (tracked && tracked.from >= 0 && tracked.to <= docLen) ? tracked : a
    })
    view.dispatch({
      effects: setAnnotationsEffect.of(toDispatch),
      annotations: [Transaction.addToHistory.of(false)]
    })
  }, [annotations])

  // Scroll to line requested by project search navigation
  useEffect(() => {
    if (pendingScrollToLine === null) return
    const view = viewRef.current
    if (!view) return
    const lineCount = view.state.doc.lines
    const lineNum = Math.max(1, Math.min(pendingScrollToLine, lineCount))
    const line = view.state.doc.line(lineNum)
    view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
    clearPendingScrollToLine()
  }, [pendingScrollToLine])

  // Reconfigure theme when font size or colour theme changes
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: themeCompartment.reconfigure(buildTheme(fontSize, theme === 'dark')) })
  }, [fontSize, theme])

  useEffect(() => {
    return window.api.onMenuAction((action) => {
      if (action === 'find' && viewRef.current) {
        openSearchPanel(viewRef.current)
      }
    })
  }, [])

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
    },
    ...(hasSelection ? [
      'separator' as const,
      {
        label: 'Generate feedback',
        action: () => {
          const view = viewRef.current
          if (!view) return
          const { from, to } = view.state.selection.main
          const text = view.state.sliceDoc(from, to)
          if (!text.trim()) return
          const annotation: TextAnnotation = {
            id: `custom-${Date.now()}`,
            type: 'custom',
            from,
            to,
            matchedText: text,
            message: 'Generating feedback...',
            autoAnalyse: true,
          }
          const store = useEditorStore.getState()
          store.setAnnotations([...store.annotations, annotation])
          store.setRightPanelTab('feedback')
        }
      },
      {
        label: 'Add comment',
        action: () => {
          const view = viewRef.current
          if (!view) return
          const { from, to } = view.state.selection.main
          const text = view.state.sliceDoc(from, to)
          if (!text.trim()) return
          setMenuPos(null)
          setPendingComment({ from, to, text })
          setCommentDraft('')
        }
      }
    ] : [])
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
      {pendingComment && (
        <div className="comment-modal-overlay" onClick={() => setPendingComment(null)}>
          <div className="comment-modal" onClick={e => e.stopPropagation()}>
            <div className="comment-modal-excerpt">
              &ldquo;{pendingComment.text.length > 80
                ? pendingComment.text.slice(0, 80) + '…'
                : pendingComment.text}&rdquo;
            </div>
            <textarea
              className="comment-modal-input"
              placeholder="Add a comment…"
              value={commentDraft}
              onChange={e => setCommentDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveComment() }
                if (e.key === 'Escape') setPendingComment(null)
              }}
              rows={3}
              autoFocus
            />
            <div className="comment-modal-actions">
              <button className="comment-modal-cancel" onClick={() => setPendingComment(null)}>Cancel</button>
              <button className="comment-modal-save" onClick={saveComment} disabled={!commentDraft.trim()}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
