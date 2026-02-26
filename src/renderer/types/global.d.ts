import type { FileNode, AIPayload, RevisionMeta, Attachment } from './editor'

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
    }
  }
}
