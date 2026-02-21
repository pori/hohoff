import { useEffect, useState } from 'react'
import { FileTree } from './components/FileTree/FileTree'
import { MarkdownEditor } from './components/Editor/MarkdownEditor'
import { ChatPanel } from './components/AIChat/ChatPanel'
import { AnalysisToolbar } from './components/Toolbar/AnalysisToolbar'
import { useEditorStore } from './store/editorStore'
import './styles/app.css'

export default function App(): JSX.Element {
  const { setFileTree, activeFilePath, isDirty, markSaved, activeFileContent, theme, toggleTheme } =
    useEditorStore()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [chatOpen, setChatOpen] = useState(true)

  // Load file tree on mount and apply persisted theme
  useEffect(() => {
    window.api.listFiles().then(setFileTree)
    document.documentElement.classList.toggle('light', theme === 'light')
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
    <div
      className="app-layout"
      data-sidebar={sidebarOpen ? 'open' : 'closed'}
      data-chat={chatOpen ? 'open' : 'closed'}
    >
      <div className="app-titlebar">
        <span className="app-titlebar-title">Hohoff Editor</span>
        <div className="app-titlebar-right">
          <div className="app-layout-toggle">
            <button
              className={`app-layout-toggle-seg${sidebarOpen ? ' active' : ''}`}
              onClick={() => setSidebarOpen((v) => !v)}
              title={sidebarOpen ? 'Hide file tree' : 'Show file tree'}
            />
            <div className="app-layout-toggle-seg app-layout-toggle-seg--mid" />
            <button
              className={`app-layout-toggle-seg${chatOpen ? ' active' : ''}`}
              onClick={() => setChatOpen((v) => !v)}
              title={chatOpen ? 'Hide AI chat' : 'Show AI chat'}
            />
          </div>
          <button
            className="app-titlebar-theme-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
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
