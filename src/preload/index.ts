import { contextBridge, ipcRenderer } from 'electron'
import type { FileNode, AIPayload } from '../renderer/types/editor'

contextBridge.exposeInMainWorld('api', {
  listFiles: (): Promise<FileNode[]> => ipcRenderer.invoke('fs:listFiles'),

  readFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('fs:readFile', filePath),

  writeFile: (filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),

  streamAIMessage: (
    payload: AIPayload,
    onChunk: (chunk: string) => void
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const chunkHandler = (_: Electron.IpcRendererEvent, chunk: string): void => {
        onChunk(chunk)
      }
      const doneHandler = (): void => {
        ipcRenderer.removeListener('ai:chunk', chunkHandler)
        ipcRenderer.removeListener('ai:done', doneHandler)
        ipcRenderer.removeListener('ai:error', errorHandler)
        resolve()
      }
      const errorHandler = (_: Electron.IpcRendererEvent, message: string): void => {
        ipcRenderer.removeListener('ai:chunk', chunkHandler)
        ipcRenderer.removeListener('ai:done', doneHandler)
        ipcRenderer.removeListener('ai:error', errorHandler)
        reject(new Error(message))
      }

      ipcRenderer.on('ai:chunk', chunkHandler)
      ipcRenderer.on('ai:done', doneHandler)
      ipcRenderer.on('ai:error', errorHandler)

      ipcRenderer.invoke('ai:streamMessage', payload).catch(reject)
    })
  },

  removeAIListener: (): void => {
    ipcRenderer.removeAllListeners('ai:chunk')
    ipcRenderer.removeAllListeners('ai:done')
    ipcRenderer.removeAllListeners('ai:error')
  }
})
