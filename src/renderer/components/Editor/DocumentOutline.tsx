import { useMemo } from 'react'
import { EditorView } from '@codemirror/view'
import { useEditorStore } from '../../store/editorStore'
import { currentEditorView } from './MarkdownEditor'
import './DocumentOutline.css'

type OutlineItem =
  | { type: 'heading'; level: 1 | 2 | 3; text: string; offset: number; key: string }
  | { type: 'divider'; offset: number; nth: number; key: string }

function parseOutline(content: string): OutlineItem[] {
  const items: OutlineItem[] = []
  const lines = content.split('\n')
  let offset = 0
  let dividerCount = 0

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/)
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3
      const text = headingMatch[2].trim()
      items.push({ type: 'heading', level, text, offset, key: `h-${offset}` })
    } else if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      dividerCount++
      items.push({ type: 'divider', offset, nth: dividerCount, key: `d-${offset}` })
    }
    offset += line.length + 1
  }

  return items
}

function navigateTo(offset: number): void {
  const view = currentEditorView
  if (!view) return
  view.dispatch({
    selection: { anchor: offset },
    effects: EditorView.scrollIntoView(offset, { y: 'start' })
  })
  view.focus()
}

export function DocumentOutline(): JSX.Element {
  const activeFileContent = useEditorStore((s) => s.activeFileContent)
  const outlineOpen = useEditorStore((s) => s.outlineOpen)
  const items = useMemo(() => parseOutline(activeFileContent), [activeFileContent])

  return (
    <div className={`outline-panel${outlineOpen ? ' outline-panel--open' : ''}`}>
      <div className="outline-header">OUTLINE</div>
      <div className="outline-list">
        {items.length === 0 ? (
          <div className="outline-empty">No headings</div>
        ) : (
          items.map((item) => {
            if (item.type === 'heading') {
              return (
                <button
                  key={item.key}
                  className={`outline-item outline-item--h${item.level}`}
                  onClick={() => navigateTo(item.offset)}
                  title={item.text}
                >
                  {item.text}
                </button>
              )
            }
            return (
              <button
                key={item.key}
                className="outline-item outline-divider"
                onClick={() => navigateTo(item.offset)}
                title={`Divider ${item.nth}`}
              >
                ———
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
