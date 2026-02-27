import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFileSync } from 'fs'
import { extname, basename } from 'path'
import { listDraftFiles, readMarkdownFile, writeMarkdownFile, getProjectWordCount, saveOrderFile, readSession, writeSession, saveRevision, listRevisions, loadRevision, deleteRevision, renameFileOrDir, deleteFileOrDir, createMarkdownFile, createSubdirectory } from './fileSystem'
import { streamMessage } from './aiService'
import type { AIPayload, Attachment } from '../renderer/types/editor'

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

  ipcMain.handle('fs:rename', async (_event, oldPath: string, newName: string) => {
    return await renameFileOrDir(oldPath, newName)
  })

  ipcMain.handle('fs:delete', async (_event, targetPath: string) => {
    await deleteFileOrDir(targetPath)
  })

  ipcMain.handle('fs:createFile', async (_event, parentPath: string, name: string) => {
    return await createMarkdownFile(parentPath, name)
  })

  ipcMain.handle('fs:createDir', async (_event, parentPath: string, name: string) => {
    return await createSubdirectory(parentPath, name)
  })

  ipcMain.handle('fs:pickAttachments', async (event): Promise<Attachment[]> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Supported Files', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'txt', 'md', 'pdf'] },
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
        { name: 'Text Files', extensions: ['txt', 'md'] },
        { name: 'PDF', extensions: ['pdf'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) return []

    const attachments: Attachment[] = []
    for (const filePath of result.filePaths) {
      const name = basename(filePath)
      const ext = extname(filePath).toLowerCase()

      if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
        const data = readFileSync(filePath).toString('base64')
        const mimeType =
          ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
          : ext === '.png' ? 'image/png'
          : ext === '.gif' ? 'image/gif'
          : 'image/webp'
        attachments.push({ name, mimeType, data })
      } else if (['.txt', '.md'].includes(ext)) {
        const data = readFileSync(filePath, 'utf-8')
        attachments.push({ name, mimeType: 'text/plain', data })
      } else if (ext === '.pdf') {
        // pdf-parse v2 API: new PDFParse({ data: buffer }) then .getText()
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { PDFParse } = require('pdf-parse') as { PDFParse: new (opts: { data: Uint8Array }) => { getText: () => Promise<{ text: string }> } }
        const buffer = readFileSync(filePath)
        const parser = new PDFParse({ data: new Uint8Array(buffer) })
        const parsed = await parser.getText()
        attachments.push({ name, mimeType: 'application/pdf', data: parsed.text })
      }
    }
    return attachments
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
