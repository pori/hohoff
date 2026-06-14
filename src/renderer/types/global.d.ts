import type { FileNode, AIPayload, RevisionMeta, Attachment, SearchFileResult, GlobalConfig, TelemetryData, Submission } from './editor'
import type { ExportOptions } from '../components/Export/ExportDialog'

interface SearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  isRegex: boolean
}

declare global {
  interface Window {
    api: {
      listFiles: () => Promise<FileNode[]>
      readFile: (filePath: string) => Promise<string>
      writeFile: (filePath: string, content: string) => Promise<void>
      streamAIMessage: (
        payload: AIPayload,
        onChunk: (chunk: string) => void
      ) => Promise<void>
      removeAIListener: () => void
      getProjectWordCount: () => Promise<number>
      saveOrder: (order: Record<string, string[]>) => Promise<void>
      pickAttachments: () => Promise<Attachment[]>
      saveRevision: (filePath: string, content: string) => Promise<void>
      listRevisions: (filePath: string) => Promise<RevisionMeta[]>
      loadRevision: (filePath: string, revisionId: string) => Promise<string>
      deleteRevision: (filePath: string, revisionId: string) => Promise<void>
      renameNode: (oldPath: string, newName: string) => Promise<string>
      deleteNode: (targetPath: string) => Promise<void>
      createFile: (parentPath: string, name: string) => Promise<string>
      createDir: (parentPath: string, name: string) => Promise<string>
      moveFile: (sourcePath: string, targetDirPath: string) => Promise<string>
      openStoryBible: () => Promise<{ path: string; content: string }>
      writeStoryBible: (content: string) => Promise<string>
      openPublisherPack: () => Promise<{ path: string; content: string }>
      onMenuAction: (handler: (action: string) => void) => () => void
      searchFiles: (query: string, options: SearchOptions) => Promise<SearchFileResult[]>
      replaceInFiles: (query: string, replacement: string, options: SearchOptions, filePaths: string[]) => Promise<string[]>
      readConfig: () => Promise<GlobalConfig>
      writeConfig: (updates: Partial<GlobalConfig>) => Promise<void>
      pickProjectFolder: () => Promise<string | null>
      exportPDF: (content: string, fileName: string) => Promise<void>
      exportProjectPDF: (opts: ExportOptions) => Promise<void>
      readAllDraftFiles: () => Promise<{ relativePath: string; content: string }[]>
      trackWordSnapshot: (filePath: string, wordCount: number) => Promise<void>
      flushTelemetry: () => Promise<void>
      readTelemetry: () => Promise<TelemetryData>
      readSubmissions: () => Promise<Submission[]>
      writeSubmissions: (data: Submission[]) => Promise<void>
      readSession: () => Promise<Record<string, unknown>>
      writeSession: (data: Record<string, unknown>) => Promise<void>
    }
  }
}
