import { useEffect, useState } from 'react'
import { FileTree } from './components/FileTree/FileTree'
import { MarkdownEditor } from './components/Editor/MarkdownEditor'
import { DocumentOutline } from './components/Editor/DocumentOutline'
import { ChatPanel } from './components/AIChat/ChatPanel'
import { AnalysisToolbar } from './components/Toolbar/AnalysisToolbar'
import { RevisionPanel } from './components/Revisions/RevisionPanel'
import { ProjectSearchModal } from './components/Search/ProjectSearchModal'
import { useEditorStore } from './store/editorStore'
import './styles/app.css'

export default function App(): JSX.Element {
  const {
    setFileTree, activeFilePath, isDirty, markSaved, activeFileContent, theme, toggleTheme,
    loadSession, revisionPanelOpen, toggleRevisionPanel, fontSize, setFontSize,
    openProjectSearch
  } = useEditorStore()
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem('sidebarOpen') !== 'false'
  )
  const [chatOpen, setChatOpen] = useState(
    () => localStorage.getItem('chatOpen') !== 'false'
  )

  // Load file tree, apply persisted theme, and restore last session
  useEffect(() => {
    window.api.listFiles().then(setFileTree)
    document.documentElement.classList.toggle('light', theme === 'light')
    loadSession()
  }, [])

  // Handle menu actions sent from the main process
  useEffect(() => {
    return window.api.onMenuAction(async (action) => {
      if (action === 'save') {
        if (activeFilePath && isDirty) {
          await window.api.writeFile(activeFilePath, activeFileContent)
          await window.api.saveRevision(activeFilePath, activeFileContent)
          markSaved()
        }
      } else if (action === 'toggleSidebar') {
        setSidebarOpen((v) => { const n = !v; localStorage.setItem('sidebarOpen', String(n)); return n })
      } else if (action === 'toggleChat') {
        setChatOpen((v) => { const n = !v; localStorage.setItem('chatOpen', String(n)); return n })
      } else if (action === 'toggleRevisions') {
        toggleRevisionPanel()
      } else if (action === 'toggleTheme') {
        toggleTheme()
      } else if (action === 'fontIncrease') {
        setFontSize(fontSize + 1)
      } else if (action === 'fontDecrease') {
        setFontSize(fontSize - 1)
      } else if (action === 'fontReset') {
        setFontSize(15)
      } else if (action === 'projectSearch') {
        openProjectSearch()
      }
    })
  }, [activeFilePath, isDirty, activeFileContent, fontSize])

  // Handle Cmd+S / Ctrl+S and Cmd+Shift+F / Ctrl+Shift+F
  useEffect(() => {
    const handler = async (e: KeyboardEvent): Promise<void> => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (activeFilePath && isDirty) {
          await window.api.writeFile(activeFilePath, activeFileContent)
          await window.api.saveRevision(activeFilePath, activeFileContent)
          markSaved()
        }
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault()
        openProjectSearch()
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
              onClick={() => setSidebarOpen((v) => { const next = !v; localStorage.setItem('sidebarOpen', String(next)); return next })}
              title={sidebarOpen ? 'Hide file tree' : 'Show file tree'}
            />
            <div className="app-layout-toggle-seg app-layout-toggle-seg--mid" />
            <button
              className={`app-layout-toggle-seg${chatOpen ? ' active' : ''}`}
              onClick={() => setChatOpen((v) => { const next = !v; localStorage.setItem('chatOpen', String(next)); return next })}
              title={chatOpen ? 'Hide AI chat' : 'Show AI chat'}
            />
          </div>
          <div className="app-titlebar-icon-group">
            <button
              className={`app-titlebar-theme-btn app-titlebar-revision-btn${revisionPanelOpen ? ' active' : ''}`}
              onClick={toggleRevisionPanel}
              title="Revision history"
            >
              ⟳
            </button>
            <button
              className="app-titlebar-theme-btn"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
          </div>
        </div>
      </div>
      <aside className="sidebar">
        <FileTree />
      </aside>
      <main className="editor-area" style={{ position: 'relative' }}>
        <AnalysisToolbar />
        <div className="editor-body">
          <DocumentOutline />
          <MarkdownEditor />
        </div>
        {revisionPanelOpen && <RevisionPanel />}
      </main>
      <aside className="chat-area">
        <ChatPanel />
      </aside>
      <ProjectSearchModal />
    </div>
  )
}
