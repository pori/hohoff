import { create } from 'zustand'
import type { FileNode, ChatMessage, ChatSession, TextAnnotation, AnalysisMode, RevisionMeta, AttachmentMeta } from '../types/editor'

interface AnnotationFileState {
  mode: AnalysisMode
  annotations: TextAnnotation[]
}

interface EditorState {
  // File tree
  fileTree: FileNode[]
  setFileTree: (tree: FileNode[]) => void

  // Active file
  activeFilePath: string | null
  activeFileContent: string
  isDirty: boolean
  setActiveFile: (path: string, content: string) => void
  setContent: (content: string) => void
  markSaved: () => void

  // Chat - persisted per file path, multiple sessions per file
  chatSessionsByFile: Record<string, ChatSession[]>
  activeSessionIdByFile: Record<string, string>
  chatHistory: ChatMessage[]
  isAILoading: boolean
  aiError: string | null
  addUserMessage: (text: string, attachments?: AttachmentMeta[]) => void
  startAssistantMessage: () => void
  appendToLastAssistantMessage: (chunk: string) => void
  setAILoading: (loading: boolean) => void
  setAIError: (error: string | null) => void
  newChat: () => void
  setActiveSession: (sessionId: string) => void

  // Annotations (highlights in editor) — also persisted per file
  annotations: TextAnnotation[]
  annotationsByFile: Record<string, AnnotationFileState>
  setAnnotations: (annotations: TextAnnotation[]) => void
  removeAnnotation: (id: string) => void
  clearAnnotations: () => void
  markAnnotationApplied: (id: string) => void
  linkAnnotationsToMessage: (messageId: string, annotationIds: string[]) => void

  // Analysis mode
  analysisMode: AnalysisMode
  setAnalysisMode: (mode: AnalysisMode) => void

  // Scroll positions per file
  scrollPositions: Record<string, number>
  setScrollPosition: (filePath: string, scrollTop: number) => void

  // File tree reordering
  moveNode: (dirPath: string, fromIdx: number, toIdx: number) => void

  // Clear active file (e.g. after deletion)
  clearActiveFile: () => void

  // Word counts
  projectWordCount: number
  setProjectWordCount: (count: number) => void

  // Editor font size
  fontSize: number
  setFontSize: (size: number) => void

  // Theme
  theme: 'dark' | 'light'
  toggleTheme: () => void

  // Revision panel
  revisionPanelOpen: boolean
  toggleRevisionPanel: () => void
  revisions: RevisionMeta[]
  setRevisions: (revisions: RevisionMeta[]) => void

  // Session persistence
  loadSession: () => Promise<void>
}

// Debounced session writer — coalesces rapid changes into one write
let _sessionTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(getData: () => Record<string, unknown>): void {
  if (_sessionTimer) clearTimeout(_sessionTimer)
  _sessionTimer = setTimeout(() => {
    const api = (window as unknown as { api?: { writeSession: (d: Record<string, unknown>) => Promise<void> } }).api
    api?.writeSession(getData()).catch(console.error)
  }, 1500)
}

export const useEditorStore = create<EditorState>((set, get) => ({
  fileTree: [],
  setFileTree: (fileTree) => set({ fileTree }),

  moveNode: (dirPath, fromIdx, toIdx) => {
    set((s) => {
      let newTree: typeof s.fileTree

      if (dirPath === '__root__') {
        newTree = [...s.fileTree]
        const [moved] = newTree.splice(fromIdx, 1)
        newTree.splice(toIdx, 0, moved)
      } else {
        newTree = s.fileTree.map((node) => {
          if (node.path !== dirPath || !node.children) return node
          const children = [...node.children]
          const [moved] = children.splice(fromIdx, 1)
          children.splice(toIdx, 0, moved)
          return { ...node, children }
        })
      }

      const orderMap: Record<string, string[]> = {}
      orderMap['__root__'] = newTree.map((n) => n.name)
      for (const node of newTree) {
        if (node.type === 'directory' && node.children) {
          orderMap[node.path] = node.children.map((c) => c.name)
        }
      }
      window.api.saveOrder(orderMap).catch(console.error)

      return { fileTree: newTree }
    })
  },

  clearActiveFile: () => set({ activeFilePath: null, activeFileContent: '', isDirty: false }),

  activeFilePath: null,
  activeFileContent: '',
  isDirty: false,
  setActiveFile: (path, content) => {
    const s = get()
    const sessions = s.chatSessionsByFile[path] ?? []
    const activeId = s.activeSessionIdByFile[path]
    const activeSession = sessions.find(sess => sess.id === activeId) ?? sessions[sessions.length - 1]
    const existing = activeSession?.messages ?? []
    const savedAnnotationState = s.annotationsByFile[path]
    set({
      activeFilePath: path,
      activeFileContent: content,
      isDirty: false,
      chatHistory: existing,
      annotations: savedAnnotationState?.annotations.filter(a => !a.applied) ?? [],
      analysisMode: savedAnnotationState?.mode ?? 'none'
    })
    scheduleSave(() => {
      const st = get()
      return {
        activeFilePath: st.activeFilePath,
        scrollPositions: st.scrollPositions,
        chatSessionsByFile: st.chatSessionsByFile,
        activeSessionIdByFile: st.activeSessionIdByFile,
        annotationsByFile: st.annotationsByFile
      }
    })
  },
  setContent: (content) => set({ activeFileContent: content, isDirty: true }),
  markSaved: () => set({ isDirty: false }),

  chatSessionsByFile: {},
  activeSessionIdByFile: {},
  chatHistory: [],
  isAILoading: false,
  aiError: null,

  addUserMessage: (text, attachments?) => {
    const msg: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: text, attachments }
    set((s) => {
      const history = [...s.chatHistory, msg]
      if (!s.activeFilePath) return { chatHistory: history }
      let sessions = s.chatSessionsByFile[s.activeFilePath] ?? []
      let activeId = s.activeSessionIdByFile[s.activeFilePath]
      // If no session exists yet, create the first one
      if (sessions.length === 0 || !activeId) {
        const newSession: ChatSession = { id: `session-${Date.now()}`, createdAt: Date.now(), messages: history }
        return {
          chatHistory: history,
          chatSessionsByFile: { ...s.chatSessionsByFile, [s.activeFilePath]: [newSession] },
          activeSessionIdByFile: { ...s.activeSessionIdByFile, [s.activeFilePath]: newSession.id }
        }
      }
      const updatedSessions = sessions.map(sess =>
        sess.id === activeId ? { ...sess, messages: history } : sess
      )
      return { chatHistory: history, chatSessionsByFile: { ...s.chatSessionsByFile, [s.activeFilePath]: updatedSessions } }
    })
    scheduleSave(() => {
      const st = get()
      return {
        activeFilePath: st.activeFilePath,
        scrollPositions: st.scrollPositions,
        chatSessionsByFile: st.chatSessionsByFile,
        activeSessionIdByFile: st.activeSessionIdByFile,
        annotationsByFile: st.annotationsByFile
      }
    })
  },

  startAssistantMessage: () => {
    const msg: ChatMessage = { id: `asst-${Date.now()}`, role: 'assistant', content: '' }
    set((s) => {
      const history = [...s.chatHistory, msg]
      if (!s.activeFilePath) return { chatHistory: history }
      const activeId = s.activeSessionIdByFile[s.activeFilePath]
      const sessions = (s.chatSessionsByFile[s.activeFilePath] ?? []).map(sess =>
        sess.id === activeId ? { ...sess, messages: history } : sess
      )
      return { chatHistory: history, chatSessionsByFile: { ...s.chatSessionsByFile, [s.activeFilePath]: sessions } }
    })
  },

  appendToLastAssistantMessage: (chunk) => {
    set((s) => {
      const history = [...s.chatHistory]
      const last = history[history.length - 1]
      if (last?.role === 'assistant') {
        history[history.length - 1] = { ...last, content: last.content + chunk }
      }
      if (!s.activeFilePath) return { chatHistory: history }
      const activeId = s.activeSessionIdByFile[s.activeFilePath]
      const sessions = (s.chatSessionsByFile[s.activeFilePath] ?? []).map(sess =>
        sess.id === activeId ? { ...sess, messages: history } : sess
      )
      return { chatHistory: history, chatSessionsByFile: { ...s.chatSessionsByFile, [s.activeFilePath]: sessions } }
    })
  },

  setAILoading: (isAILoading) => {
    set({ isAILoading })
    // When AI finishes, persist the completed chat history
    if (!isAILoading) {
      scheduleSave(() => {
        const st = get()
        return {
          activeFilePath: st.activeFilePath,
          scrollPositions: st.scrollPositions,
          chatSessionsByFile: st.chatSessionsByFile,
          activeSessionIdByFile: st.activeSessionIdByFile,
          annotationsByFile: st.annotationsByFile
        }
      })
    }
  },
  setAIError: (aiError) => set({ aiError }),

  newChat: () => {
    set((s) => {
      if (!s.activeFilePath) return {}
      const newSession: ChatSession = { id: `session-${Date.now()}`, createdAt: Date.now(), messages: [] }
      const existingSessions = s.chatSessionsByFile[s.activeFilePath] ?? []
      return {
        chatSessionsByFile: { ...s.chatSessionsByFile, [s.activeFilePath]: [...existingSessions, newSession] },
        activeSessionIdByFile: { ...s.activeSessionIdByFile, [s.activeFilePath]: newSession.id },
        chatHistory: []
      }
    })
    scheduleSave(() => {
      const st = get()
      return {
        activeFilePath: st.activeFilePath,
        scrollPositions: st.scrollPositions,
        chatSessionsByFile: st.chatSessionsByFile,
        activeSessionIdByFile: st.activeSessionIdByFile,
        annotationsByFile: st.annotationsByFile
      }
    })
  },

  setActiveSession: (sessionId: string) => {
    set((s) => {
      if (!s.activeFilePath) return {}
      const session = (s.chatSessionsByFile[s.activeFilePath] ?? []).find(sess => sess.id === sessionId)
      if (!session) return {}
      return {
        activeSessionIdByFile: { ...s.activeSessionIdByFile, [s.activeFilePath]: sessionId },
        chatHistory: session.messages
      }
    })
  },

  annotations: [],
  annotationsByFile: {},
  setAnnotations: (annotations) => {
    set((s) => {
      // Preserve previously applied annotations so chat history links remain valid
      const existingApplied = s.activeFilePath
        ? (s.annotationsByFile[s.activeFilePath]?.annotations ?? []).filter(a => a.applied)
        : []
      const merged = [...existingApplied, ...annotations]
      const annotationsByFile = s.activeFilePath
        ? { ...s.annotationsByFile, [s.activeFilePath]: { mode: s.analysisMode, annotations: merged } }
        : s.annotationsByFile
      return { annotations, annotationsByFile }
    })
    scheduleSave(() => {
      const st = get()
      return {
        activeFilePath: st.activeFilePath,
        scrollPositions: st.scrollPositions,
        chatSessionsByFile: st.chatSessionsByFile,
        activeSessionIdByFile: st.activeSessionIdByFile,
        annotationsByFile: st.annotationsByFile
      }
    })
  },
  removeAnnotation: (id) => {
    set((s) => {
      const annotations = s.annotations.filter((a) => a.id !== id)
      const annotationsByFile = s.activeFilePath
        ? { ...s.annotationsByFile, [s.activeFilePath]: { mode: s.analysisMode, annotations } }
        : s.annotationsByFile
      return { annotations, annotationsByFile }
    })
    scheduleSave(() => {
      const st = get()
      return {
        activeFilePath: st.activeFilePath,
        scrollPositions: st.scrollPositions,
        chatSessionsByFile: st.chatSessionsByFile,
        activeSessionIdByFile: st.activeSessionIdByFile,
        annotationsByFile: st.annotationsByFile
      }
    })
  },
  clearAnnotations: () => {
    set((s) => {
      const annotationsByFile = s.activeFilePath
        ? { ...s.annotationsByFile, [s.activeFilePath]: { mode: 'none' as AnalysisMode, annotations: [] } }
        : s.annotationsByFile
      return { annotations: [], analysisMode: 'none', annotationsByFile }
    })
    scheduleSave(() => {
      const st = get()
      return {
        activeFilePath: st.activeFilePath,
        scrollPositions: st.scrollPositions,
        chatSessionsByFile: st.chatSessionsByFile,
        activeSessionIdByFile: st.activeSessionIdByFile,
        annotationsByFile: st.annotationsByFile
      }
    })
  },

  markAnnotationApplied: (id) => {
    set((s) => {
      if (!s.activeFilePath) return {}
      const fileState = s.annotationsByFile[s.activeFilePath]
      if (!fileState) return {}
      const updatedAll = fileState.annotations.map(a =>
        a.id === id ? { ...a, applied: true } : a
      )
      const annotationsByFile = {
        ...s.annotationsByFile,
        [s.activeFilePath]: { ...fileState, annotations: updatedAll }
      }
      const annotations = s.annotations.filter(a => a.id !== id)
      return { annotations, annotationsByFile }
    })
    scheduleSave(() => {
      const st = get()
      return {
        activeFilePath: st.activeFilePath,
        scrollPositions: st.scrollPositions,
        chatSessionsByFile: st.chatSessionsByFile,
        activeSessionIdByFile: st.activeSessionIdByFile,
        annotationsByFile: st.annotationsByFile
      }
    })
  },

  linkAnnotationsToMessage: (messageId, annotationIds) => {
    set((s) => {
      const history = s.chatHistory.map(m =>
        m.id === messageId ? { ...m, annotationIds } : m
      )
      if (!s.activeFilePath) return { chatHistory: history }
      const activeId = s.activeSessionIdByFile[s.activeFilePath]
      const sessions = (s.chatSessionsByFile[s.activeFilePath] ?? []).map(sess =>
        sess.id === activeId ? { ...sess, messages: history } : sess
      )
      return { chatHistory: history, chatSessionsByFile: { ...s.chatSessionsByFile, [s.activeFilePath]: sessions } }
    })
    scheduleSave(() => {
      const st = get()
      return {
        activeFilePath: st.activeFilePath,
        scrollPositions: st.scrollPositions,
        chatSessionsByFile: st.chatSessionsByFile,
        activeSessionIdByFile: st.activeSessionIdByFile,
        annotationsByFile: st.annotationsByFile
      }
    })
  },

  analysisMode: 'none',
  setAnalysisMode: (analysisMode) => {
    set((s) => {
      const annotationsByFile = s.activeFilePath
        ? { ...s.annotationsByFile, [s.activeFilePath]: { mode: analysisMode, annotations: s.annotations } }
        : s.annotationsByFile
      return { analysisMode, annotationsByFile }
    })
  },

  scrollPositions: {},
  setScrollPosition: (filePath, scrollTop) => {
    set((s) => ({ scrollPositions: { ...s.scrollPositions, [filePath]: scrollTop } }))
    scheduleSave(() => {
      const st = get()
      return {
        activeFilePath: st.activeFilePath,
        scrollPositions: st.scrollPositions,
        chatSessionsByFile: st.chatSessionsByFile,
        activeSessionIdByFile: st.activeSessionIdByFile,
        annotationsByFile: st.annotationsByFile
      }
    })
  },

  projectWordCount: 0,
  setProjectWordCount: (projectWordCount) => set({ projectWordCount }),

  revisionPanelOpen: false,
  toggleRevisionPanel: () => set((s) => ({ revisionPanelOpen: !s.revisionPanelOpen })),
  revisions: [],
  setRevisions: (revisions) => set({ revisions }),

  fontSize: Number(localStorage.getItem('editorFontSize')) || 15,
  setFontSize: (size) => {
    const clamped = Math.max(11, Math.min(24, size))
    localStorage.setItem('editorFontSize', String(clamped))
    set({ fontSize: clamped })
  },

  theme: (localStorage.getItem('editorTheme') as 'dark' | 'light') || 'dark',
  toggleTheme: () => {
    set((s) => {
      const next = s.theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem('editorTheme', next)
      document.documentElement.classList.toggle('light', next === 'light')
      return { theme: next }
    })
  },

  loadSession: async () => {
    const api = (window as unknown as { api?: { readSession: () => Promise<Record<string, unknown>>; readFile: (p: string) => Promise<string> } }).api
    if (!api) return
    try {
      const data = await api.readSession()
      const patch: Partial<EditorState> = {}

      if (data.scrollPositions && typeof data.scrollPositions === 'object') {
        patch.scrollPositions = data.scrollPositions as Record<string, number>
      }
      if (data.chatSessionsByFile && typeof data.chatSessionsByFile === 'object') {
        patch.chatSessionsByFile = data.chatSessionsByFile as Record<string, ChatSession[]>
        patch.activeSessionIdByFile = (data.activeSessionIdByFile as Record<string, string>) ?? {}
      } else if (data.chatHistoryByFile && typeof data.chatHistoryByFile === 'object') {
        // Migrate from old flat format — wrap each file's history in a single session
        const legacy = data.chatHistoryByFile as Record<string, ChatMessage[]>
        const sessions: Record<string, ChatSession[]> = {}
        const activeIds: Record<string, string> = {}
        for (const [path, messages] of Object.entries(legacy)) {
          if (Array.isArray(messages) && messages.length > 0) {
            const id = `session-migrated-${Date.now()}`
            sessions[path] = [{ id, createdAt: Date.now(), messages }]
            activeIds[path] = id
          }
        }
        patch.chatSessionsByFile = sessions
        patch.activeSessionIdByFile = activeIds
      }
      if (data.annotationsByFile && typeof data.annotationsByFile === 'object') {
        patch.annotationsByFile = data.annotationsByFile as Record<string, AnnotationFileState>
      }

      set(patch)

      // Restore active file last so setActiveFile can read the patched annotationsByFile
      if (typeof data.activeFilePath === 'string') {
        try {
          const content = await api.readFile(data.activeFilePath)
          get().setActiveFile(data.activeFilePath, content)
        } catch {
          // File may have been moved/deleted — open nothing
        }
      }
    } catch {
      // No session yet — start fresh
    }
  }
}))
