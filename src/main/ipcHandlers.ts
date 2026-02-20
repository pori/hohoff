import { ipcMain } from 'electron'
import { listDraftFiles, readMarkdownFile, writeMarkdownFile } from './fileSystem'
import { streamMessage } from './aiService'
import type { AIPayload } from '../renderer/types/editor'

export function registerIpcHandlers(): void {
  ipcMain.handle('fs:listFiles', async () => {
    return await listDraftFiles()
  })

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    return await readMarkdownFile(filePath)
  })

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    await writeMarkdownFile(filePath, content)
  })

  ipcMain.handle('ai:streamMessage', async (event, payload: AIPayload) => {
    try {
      await streamMessage(payload, (chunk: string) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('ai:chunk', chunk)
        }
      })
      if (!event.sender.isDestroyed()) {
        event.sender.send('ai:done')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!event.sender.isDestroyed()) {
        event.sender.send('ai:error', message)
      }
    }
  })
}
