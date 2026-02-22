import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { useEditorStore } from '@renderer/store/editorStore'
import { MarkdownEditor } from '@renderer/components/Editor/MarkdownEditor'
import { ChatPanel } from '@renderer/components/AIChat/ChatPanel'
import '@renderer/styles/global.css'

// Mock window.api so the renderer doesn't crash in a plain browser context
;(window as unknown as Record<string, unknown>).api = {
  listFiles: () => Promise.resolve([]),
  readFile: () => Promise.resolve(''),
  writeFile: () => Promise.resolve(),
  streamAIMessage: () => Promise.resolve(),
  removeAIListener: () => {},
  getProjectWordCount: () => Promise.resolve(0),
  saveOrder: () => Promise.resolve()
}

const DEMO_TEXT =
  `She was seen by him walking down the cobblestone path.\n\n` +
  `The old manuscript was written by an unknown author many centuries ago.\n\n` +
  `The message had been delivered by the courier at dawn.`

// Compute annotation character ranges directly from the text
const a1s = DEMO_TEXT.indexOf('She was seen')
const a1e = DEMO_TEXT.indexOf('.', a1s) + 1
const a2s = DEMO_TEXT.indexOf('The old manuscript')
const a2e = DEMO_TEXT.indexOf('.', a2s) + 1
const a3s = DEMO_TEXT.indexOf('The message')
const a3e = DEMO_TEXT.indexOf('.', a3s) + 1

// Pre-seed store before React renders so all three effects fire correctly on mount
const store = useEditorStore.getState()
store.setActiveFile('demo.md', DEMO_TEXT)
store.setAnnotations([
  {
    id: 'ann-1',
    type: 'passive_voice',
    from: a1s,
    to: a1e,
    matchedText: 'was seen by',
    message: 'Passive voice weakens the narrative tension here — placing the subject in an active role would make the sentence more immediate and visceral, which is essential for gothic prose where atmosphere must feel alive and urgent\u2026',
    suggestion: 'He saw her walking down the cobblestone path.'
  },
  {
    id: 'ann-2',
    type: 'passive_voice',
    from: a2s,
    to: a2e,
    matchedText: 'was written by',
    message: 'Passive construction distances the reader from the action; consider foregrounding the actor to strengthen the historical atmosphere.',
    suggestion: 'An unknown author wrote the old manuscript many centuries ago.'
  },
  {
    id: 'ann-3',
    type: 'style',
    from: a3s,
    to: a3e,
    matchedText: 'had been delivered by',
    message: 'Wordy passive construction: "had been delivered by"',
    suggestion: 'The courier delivered the message at dawn.'
  }
])

function DemoApp(): JSX.Element {
  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg)' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <MarkdownEditor />
      </div>
      <div style={{ width: '300px', flexShrink: 0 }}>
        <ChatPanel />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DemoApp />
  </StrictMode>
)
