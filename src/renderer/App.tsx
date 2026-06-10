import { useEffect, useState } from 'react'
import { ExportDialog } from './components/Export/ExportDialog'
import type { ExportOptions } from './components/Export/ExportDialog'
import { FileTree } from './components/FileTree/FileTree'
import { currentEditorView } from './components/Editor/MarkdownEditor'
import { MarkdownEditor } from './components/Editor/MarkdownEditor'
import { DocumentOutline } from './components/Editor/DocumentOutline'
import { ChatPanel } from './components/AIChat/ChatPanel'
import { AnalysisToolbar } from './components/Toolbar/AnalysisToolbar'
import { RevisionPanel } from './components/Revisions/RevisionPanel'
import { ProjectSearchModal } from './components/Search/ProjectSearchModal'
import { SettingsDialog } from './components/Settings/SettingsDialog'
import { HomeScreen } from './components/Home/HomeScreen'
import { useEditorStore } from './store/editorStore'
import './styles/app.css'

export default function App(): JSX.Element {
  const {
    setFileTree, activeFilePath, isDirty, markSaved, activeFileContent, theme, toggleTheme,
    loadSession, revisionPanelOpen, toggleRevisionPanel, fontSize, setFontSize,
    openProjectSearch, clearActiveFile, initPrefs, focusMode, toggleFocusMode,
    showHome, goHome, setActiveFile
  } = useEditorStore()

  const handleOpenStoryBible = async (): Promise<void> => {
    try {
      const { path, content } = await window.api.openStoryBible()
      setActiveFile(path, content)
      if (path === activeFilePath) {
        const view = currentEditorView
        if (view) {
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } })
          markSaved()
        }
      }
    } catch (err) {
      console.error('[App] openStoryBible failed:', err)
    }
  }
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem('sidebarOpen') !== 'false'
  )
  const [chatOpen, setChatOpen] = useState(
    () => localStorage.getItem('chatOpen') !== 'false'
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [isFirstRun, setIsFirstRun] = useState(false)
  const [focusPeek, setFocusPeek] = useState(false)
  const [projectTitle, setProjectTitle] = useState('')

  useEffect(() => {
    if (!focusMode) {
      setFocusPeek(false)
      return
    }
    const onMove = (e: MouseEvent): void => setFocusPeek(e.clientY < 85)
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [focusMode])

  const switchProject = async (newPath: string): Promise<void> => {
    await window.api.writeConfig({ projectPath: newPath })
    setProjectTitle(newPath.split('/').filter(Boolean).pop() ?? '')
    clearActiveFile()
    const files = await window.api.listFiles()
    setFileTree(files)
    await loadSession()
  }

  // Load file tree, restore prefs + session, and detect first run.
  // Draft-directory calls are sequenced so macOS only prompts for folder access once.
  useEffect(() => {
    async function init(): Promise<void> {
      initPrefs()
      const files = await window.api.listFiles()
      setFileTree(files)
      await loadSession()
      const cfg = await window.api.readConfig()
      if (!cfg.apiKey || !cfg.projectPath) {
        setIsFirstRun(true)
        setSettingsOpen(true)
      }
      if (cfg.projectPath) {
        setProjectTitle(cfg.projectPath.split('/').filter(Boolean).pop() ?? '')
      }
    }
    init()
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
      } else if (action === 'openSettings') {
        setSettingsOpen(true)
      } else if (action === 'toggleFocusMode') {
        toggleFocusMode()
      } else if (action === 'openProject') {
        const picked = await window.api.pickProjectFolder()
        if (picked) await switchProject(picked)
      } else if (action.startsWith('openRecent:')) {
        await switchProject(action.slice('openRecent:'.length))
      } else if (action === 'exportPDF') {
        if (activeFilePath && activeFileContent) {
          const fileName = activeFilePath.split('/').pop()?.replace(/\.md$/, '') ?? 'document'
          await window.api.exportPDF(activeFileContent, fileName)
        }
      } else if (action === 'exportProjectPDF') {
        setExportOpen(true)
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
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'g') {
        e.preventDefault()
        toggleFocusMode()
      } else if (e.key === 'Escape' && focusMode) {
        toggleFocusMode()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeFilePath, isDirty, activeFileContent, focusMode])

  return (
    <div
      className="app-layout"
      data-sidebar={sidebarOpen ? 'open' : 'closed'}
      data-chat={chatOpen ? 'open' : 'closed'}
      data-focus={focusMode ? 'on' : 'off'}
      data-peek={focusPeek ? 'on' : 'off'}
    >
      <div className="app-titlebar">
        <span className="app-titlebar-title">{projectTitle || 'Hohoff Editor'}</span>
        <div className="app-titlebar-right">
          <div className="app-layout-toggle">
            <button
              className={`app-layout-toggle-seg${sidebarOpen ? ' active' : ''}`}
              onClick={() => setSidebarOpen((v) => { const next = !v; localStorage.setItem('sidebarOpen', String(next)); return next })}
              title={sidebarOpen ? 'Hide file tree' : 'Show file tree'}
              disabled={focusMode}
            />
            <div className="app-layout-toggle-seg app-layout-toggle-seg--mid" />
            <button
              className={`app-layout-toggle-seg${chatOpen ? ' active' : ''}`}
              onClick={() => setChatOpen((v) => { const next = !v; localStorage.setItem('chatOpen', String(next)); return next })}
              title={chatOpen ? 'Hide AI chat' : 'Show AI chat'}
              disabled={focusMode}
            />
          </div>
          <div className="app-titlebar-icon-group">
            <button
              className={`app-titlebar-theme-btn${focusMode ? ' active' : ''}`}
              onClick={toggleFocusMode}
              title="Focus mode (⌘⇧G)"
            >⊡</button>
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
        <div className="sidebar-nav">
          <button
            className={`sidebar-nav-btn${showHome ? ' active' : ''}`}
            onClick={goHome}
            title="Home"
          >
            <span className="sidebar-nav-icon">⌂</span>
          </button>
          <button
            className="sidebar-nav-btn"
            onClick={handleOpenStoryBible}
            title="Open Story Bible"
          >
            <span className="sidebar-nav-icon">📖</span>
          </button>
        </div>
        <FileTree />
      </aside>
      <main className="editor-area" style={{ position: 'relative' }}>
        {showHome ? (
          <HomeScreen />
        ) : (
          <>
            <AnalysisToolbar />
            <div className="editor-body">
              <DocumentOutline />
              <MarkdownEditor />
            </div>
            {revisionPanelOpen && <RevisionPanel />}
          </>
        )}
      </main>
      <aside className="chat-area">
        <ChatPanel />
      </aside>
      {focusMode && (
        <button className="focus-exit-btn" onClick={toggleFocusMode} title="Exit focus mode (Esc)">✕</button>
      )}
      <ProjectSearchModal />
      {settingsOpen && (
        <SettingsDialog
          onClose={() => { setSettingsOpen(false); setIsFirstRun(false) }}
          isSetup={isFirstRun}
          onProjectChanged={async () => {
            clearActiveFile()
            const files = await window.api.listFiles()
            setFileTree(files)
            await loadSession()
          }}
        />
      )}
      {exportOpen && (
        <ExportDialog
          onClose={() => setExportOpen(false)}
          onExport={async (opts: ExportOptions) => {
            setExportOpen(false)
            await window.api.exportProjectPDF(opts)
          }}
        />
      )}
    </div>
  )
}
