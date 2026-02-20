import type { FileNode, AIPayload } from './editor'

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
    }
  }
}
