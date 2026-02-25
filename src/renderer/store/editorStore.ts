import { create } from 'zustand'
import type { FileNode, ChatMessage, TextAnnotation, AnalysisMode, RevisionMeta, AttachmentMeta } from '../types/editor'

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

  // Chat - persisted per file path
  chatHistoryByFile: Record<string, ChatMessage[]>
  chatHistory: ChatMessage[]
  isAILoading: boolean
  aiError: string | null
  addUserMessage: (text: string, attachments?: AttachmentMeta[]) => void
  startAssistantMessage: () => void
  appendToLastAssistantMessage: (chunk: string) => void
  setAILoading: (loading: boolean) => void
  setAIError: (error: string | null) => void
  clearChat: () => void

  // Annotations (highlights in editor) — also persisted per file
  annotations: TextAnnotation[]
  annotationsByFile: Record<string, AnnotationFileState>
  setAnnotations: (annotations: TextAnnotation[]) => void
  clearAnnotations: () => void

  // Analysis mode
  analysisMode: AnalysisMode
  setAnalysisMode: (mode: AnalysisMode) => void

  // Scroll positions per file
  scrollPositions: Record<string, number>
  setScrollPosition: (filePath: string, scrollTop: number) => void

  // File tree reordering
  moveNode: (dirPath: string, fromIdx: number, toIdx: number) => void

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

  activeFilePath: null,
  activeFileContent: '',
  isDirty: false,
  setActiveFile: (path, content) => {
    const s = get()
    const existing = s.chatHistoryByFile[path] ?? []
    const savedAnnotationState = s.annotationsByFile[path]
    set({
      activeFilePath: path,
      activeFileContent: content,
      isDirty: false,
      chatHistory: existing,
      annotations: savedAnnotationState?.annotations ?? [],
      analysisMode: savedAnnotationState?.mode ?? 'none'
    })
    scheduleSave(() => {
      const st = get()
      return {
        activeFilePath: st.activeFilePath,
        scrollPositions: st.scrollPositions,
        chatHistoryByFile: st.chatHistoryByFile,
        annotationsByFile: st.annotationsByFile
      }
    })
  },
  setContent: (content) => set({ activeFileContent: content, isDirty: true }),
  markSaved: () => set({ isDirty: false }),

  chatHistoryByFile: {},
  chatHistory: [],
  isAILoading: false,
  aiError: null,

  addUserMessage: (text, attachments?) => {
    const msg: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: text, attachments }
    set((s) => {
      const history = [...s.chatHistory, msg]
      const byFile = s.activeFilePath
        ? { ...s.chatHistoryByFile, [s.activeFilePath]: history }
        : s.chatHistoryByFile
      return { chatHistory: history, chatHistoryByFile: byFile }
    })
    scheduleSave(() => {
      const st = get()
      return {
        activeFilePath: st.activeFilePath,
        scrollPositions: st.scrollPositions,
        chatHistoryByFile: st.chatHistoryByFile,
        annotationsByFile: st.annotationsByFile
      }
    })
  },

  startAssistantMessage: () => {
    const msg: ChatMessage = { id: `asst-${Date.now()}`, role: 'assistant', content: '' }
    set((s) => {
      const history = [...s.chatHistory, msg]
      const byFile = s.activeFilePath
        ? { ...s.chatHistoryByFile, [s.activeFilePath]: history }
        : s.chatHistoryByFile
      return { chatHistory: history, chatHistoryByFile: byFile }
    })
  },

  appendToLastAssistantMessage: (chunk) => {
    set((s) => {
      const history = [...s.chatHistory]
      const last = history[history.length - 1]
      if (last?.role === 'assistant') {
        history[history.length - 1] = { ...last, content: last.content + chunk }
      }
      const byFile = s.activeFilePath
        ? { ...s.chatHistoryByFile, [s.activeFilePath]: history }
        : s.chatHistoryByFile
      return { chatHistory: history, chatHistoryByFile: byFile }
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
          chatHistoryByFile: st.chatHistoryByFile,
          annotationsByFile: st.annotationsByFile
        }
      })
    }
  },
  setAIError: (aiError) => set({ aiError }),

  clearChat: () => {
    set((s) => {
      const byFile = s.activeFilePath
        ? { ...s.chatHistoryByFile, [s.activeFilePath]: [] }
        : s.chatHistoryByFile
      return { chatHistory: [], chatHistoryByFile: byFile }
    })
    scheduleSave(() => {
      const st = get()
      return {
        activeFilePath: st.activeFilePath,
        scrollPositions: st.scrollPositions,
        chatHistoryByFile: st.chatHistoryByFile,
        annotationsByFile: st.annotationsByFile
      }
    })
  },

  annotations: [],
  annotationsByFile: {},
  setAnnotations: (annotations) => {
    set((s) => {
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
        chatHistoryByFile: st.chatHistoryByFile,
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
        chatHistoryByFile: st.chatHistoryByFile,
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
        chatHistoryByFile: st.chatHistoryByFile,
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
      if (data.chatHistoryByFile && typeof data.chatHistoryByFile === 'object') {
        patch.chatHistoryByFile = data.chatHistoryByFile as Record<string, ChatMessage[]>
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
