import { ipcMain } from 'electron'
import { listDraftFiles, readMarkdownFile, writeMarkdownFile, getProjectWordCount, saveOrderFile, readSession, writeSession, saveRevision, listRevisions, loadRevision, deleteRevision } from './fileSystem'
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

  ipcMain.handle('fs:projectWordCount', async () => {
    return await getProjectWordCount()
  })

  ipcMain.handle('fs:saveOrder', async (_event, order: Record<string, string[]>) => {
    await saveOrderFile(order)
  })

  ipcMain.handle('session:read', async () => {
    return await readSession()
  })

  ipcMain.handle('session:write', async (_event, data: Record<string, unknown>) => {
    await writeSession(data)
  })

  ipcMain.handle('revisions:save', async (_event, filePath: string, content: string) => {
    await saveRevision(filePath, content)
  })

  ipcMain.handle('revisions:list', async (_event, filePath: string) => {
    return await listRevisions(filePath)
  })

  ipcMain.handle('revisions:load', async (_event, filePath: string, revisionId: string) => {
    return await loadRevision(filePath, revisionId)
  })

  ipcMain.handle('revisions:delete', async (_event, filePath: string, revisionId: string) => {
    await deleteRevision(filePath, revisionId)
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
