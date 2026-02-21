import { useEffect } from 'react'
import { FileTree } from './components/FileTree/FileTree'
import { MarkdownEditor } from './components/Editor/MarkdownEditor'
import { ChatPanel } from './components/AIChat/ChatPanel'
import { AnalysisToolbar } from './components/Toolbar/AnalysisToolbar'
import { useEditorStore } from './store/editorStore'
import './styles/app.css'

export default function App(): JSX.Element {
  const { setFileTree, activeFilePath, isDirty, markSaved, activeFileContent } =
    useEditorStore()

  // Load file tree on mount
  useEffect(() => {
    window.api.listFiles().then(setFileTree)
  }, [])

  // Handle Cmd+S / Ctrl+S
  useEffect(() => {
    const handler = async (e: KeyboardEvent): Promise<void> => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (activeFilePath && isDirty) {
          await window.api.writeFile(activeFilePath, activeFileContent)
          markSaved()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeFilePath, isDirty, activeFileContent])

  return (
    <div className="app-layout">
      <div className="app-titlebar">
        <span className="app-titlebar-title">Hohoff Editor</span>
      </div>
      <aside className="sidebar">
        <FileTree />
      </aside>
      <main className="editor-area">
        <AnalysisToolbar />
        <MarkdownEditor />
      </main>
      <aside className="chat-area">
        <ChatPanel />
      </aside>
    </div>
  )
}
