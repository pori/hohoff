import { create } from 'zustand'
import type { FileNode, ChatMessage, TextAnnotation, AnalysisMode } from '../types/editor'

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
  addUserMessage: (text: string) => void
  startAssistantMessage: () => void
  appendToLastAssistantMessage: (chunk: string) => void
  setAILoading: (loading: boolean) => void
  setAIError: (error: string | null) => void
  clearChat: () => void

  // Annotations (highlights in editor)
  annotations: TextAnnotation[]
  setAnnotations: (annotations: TextAnnotation[]) => void
  clearAnnotations: () => void

  // Analysis mode
  analysisMode: AnalysisMode
  setAnalysisMode: (mode: AnalysisMode) => void

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
    const existing = get().chatHistoryByFile[path] ?? []
    set({
      activeFilePath: path,
      activeFileContent: content,
      isDirty: false,
      chatHistory: existing,
      annotations: [],
      analysisMode: 'none'
    })
  },
  setContent: (content) => set({ activeFileContent: content, isDirty: true }),
  markSaved: () => set({ isDirty: false }),

  chatHistoryByFile: {},
  chatHistory: [],
  isAILoading: false,
  aiError: null,

  addUserMessage: (text) => {
    const msg: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: text }
    set((s) => {
      const history = [...s.chatHistory, msg]
      const byFile = s.activeFilePath
        ? { ...s.chatHistoryByFile, [s.activeFilePath]: history }
        : s.chatHistoryByFile
      return { chatHistory: history, chatHistoryByFile: byFile }
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

  setAILoading: (isAILoading) => set({ isAILoading }),
  setAIError: (aiError) => set({ aiError }),

  clearChat: () => {
    set((s) => {
      const byFile = s.activeFilePath
        ? { ...s.chatHistoryByFile, [s.activeFilePath]: [] }
        : s.chatHistoryByFile
      return { chatHistory: [], chatHistoryByFile: byFile }
    })
  },

  annotations: [],
  setAnnotations: (annotations) => set({ annotations }),
  clearAnnotations: () => set({ annotations: [], analysisMode: 'none' }),

  analysisMode: 'none',
  setAnalysisMode: (analysisMode) => set({ analysisMode }),

  projectWordCount: 0,
  setProjectWordCount: (projectWordCount) => set({ projectWordCount }),

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
  }
}))
