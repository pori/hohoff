import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, unlinkSync } from 'fs'
import { extname, basename, join } from 'path'
import { tmpdir } from 'os'
import { listDraftFiles, readMarkdownFile, writeMarkdownFile, getProjectWordCount, saveOrderFile, readSession, writeSession, saveRevision, listRevisions, loadRevision, deleteRevision, renameFileOrDir, deleteFileOrDir, createMarkdownFile, createSubdirectory, moveFileOrDir, readStoryBibleFile, openStoryBibleFile, writeStoryBibleFile, searchAcrossFiles, replaceInFiles, readAllDraftFiles } from './fileSystem'
import type { SearchOptions } from './fileSystem'
import { streamMessage, resetClient } from './aiService'
import type { AIPayload, Attachment } from '../renderer/types/editor'
import { readGlobalConfig, writeGlobalConfig, getDraftRoot } from './globalConfig'
import type { GlobalConfig } from './globalConfig'

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

  ipcMain.handle('fs:move', async (_event, sourcePath: string, targetDirPath: string) => {
    return await moveFileOrDir(sourcePath, targetDirPath)
  })

  ipcMain.handle('fs:openStoryBible', async () => {
    return await openStoryBibleFile()
  })

  ipcMain.handle('fs:writeStoryBible', async (_event, content: string) => {
    return await writeStoryBibleFile(content)
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

  ipcMain.handle('fs:search', async (_event, query: string, opts: SearchOptions) => {
    return await searchAcrossFiles(query, opts)
  })

  ipcMain.handle('fs:replace', async (_event, query: string, replacement: string, opts: SearchOptions, filePaths: string[]) => {
    return await replaceInFiles(query, replacement, opts, filePaths)
  })

  ipcMain.handle('ai:streamMessage', async (event, payload: AIPayload) => {
    try {
      const storyBibleContent = (await readStoryBibleFile()) ?? undefined

      let pending = ''
      let flushTimer: ReturnType<typeof setTimeout> | null = null

      const flush = (): void => {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
        if (pending && !event.sender.isDestroyed()) {
          event.sender.send('ai:chunk', pending)
          pending = ''
        }
      }

      await streamMessage(payload, storyBibleContent, (chunk: string) => {
        pending += chunk
        if (!flushTimer) {
          flushTimer = setTimeout(flush, 30)
        }
      })

      flush()

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

  ipcMain.handle('config:read', (): GlobalConfig => {
    return readGlobalConfig()
  })

  ipcMain.handle('config:write', (_event, updates: Partial<GlobalConfig>): void => {
    writeGlobalConfig(updates)
    if (updates.apiKey !== undefined) resetClient()
  })

  ipcMain.handle('config:pickFolder', async (event): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('export:pdf', async (event, content: string, fileName: string): Promise<void> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: `${fileName}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return

    const { marked } = await import('marked')
    // Draft files use single \n between paragraphs; marked needs \n\n to create <p> elements
    const normalized = content.replace(/\r\n/g, '\n').replace(/\n(?!\n)/g, '\n\n')
    const bodyHtml = await marked(normalized)

    // Escape for safe injection into HTML attributes
    const safeTitle = fileName.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
    const headerTitle = fileName.toUpperCase().replace(/</g, '&lt;').replace(/>/g, '&gt;')

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
  @page { size: letter; margin: 1in; }
  body {
    font-family: "Courier New", Courier, monospace;
    font-size: 12pt;
    line-height: 2;
    color: #000;
    margin: 0;
    padding: 0;
  }
  h1, h2, h3 {
    font-weight: normal;
    font-size: 12pt;
    text-align: center;
    text-transform: uppercase;
    margin: 0;
    line-height: 2;
  }
  p {
    margin: 0;
    text-indent: 0.5in;
    text-align: left;
  }
  h1 + p, h2 + p, h3 + p, hr + p { text-indent: 0; }
  hr {
    border: none;
    margin: 0;
    line-height: 2;
    height: 2em;
    text-align: center;
  }
  hr::after {
    content: "#";
    display: block;
    text-align: center;
    line-height: 2;
  }
  em { font-style: italic; }
  strong { font-weight: bold; }
  blockquote { margin: 0 0 0 0.5in; }
  ul, ol { margin: 0 0 0 0.5in; }
  li { margin: 0; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`

    const tempPath = join(tmpdir(), `hohoff-export-${Date.now()}.html`)
    writeFileSync(tempPath, html, 'utf-8')

    const offscreen = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: false, contextIsolation: true }
    })

    try {
      await offscreen.loadFile(tempPath)
      const pdfBuffer = await offscreen.webContents.printToPDF({
        pageSize: 'Letter',
        displayHeaderFooter: true,
        headerTemplate: `<div style="font-size:11pt;font-family:'Courier New',Courier,monospace;width:100%;text-align:right;padding-right:72pt;">${headerTitle} / <span class="pageNumber"></span></div>`,
        footerTemplate: '<div></div>',
        margins: { marginType: 'custom', top: 1.25, bottom: 1.0, left: 1.0, right: 1.0 }
      })
      writeFileSync(result.filePath, pdfBuffer)
    } finally {
      offscreen.destroy()
      try { unlinkSync(tempPath) } catch { /* ignore */ }
    }
  })

  ipcMain.handle('export:projectPdf', async (event): Promise<void> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const projectName = basename(getDraftRoot())

    const result = await dialog.showSaveDialog(win!, {
      defaultPath: `${projectName}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return

    const docs = await readAllDraftFiles()
    if (docs.length === 0) return

    const { marked } = await import('marked')
    const normalize = (s: string) => s.replace(/\r\n/g, '\n').replace(/\n(?!\n)/g, '\n\n')

    let bodyHtml = ''
    let currentPart: string | null = null
    let needsPageBreak = false

    for (const doc of docs) {
      const slashIdx = doc.relativePath.indexOf('/')
      const partName = slashIdx !== -1 ? doc.relativePath.slice(0, slashIdx) : null

      if (partName !== null && partName !== currentPart) {
        currentPart = partName
        const safe = partName.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        bodyHtml += `<div class="page-break part-page"><div class="part-title">${safe}</div></div>`
        needsPageBreak = false
      }

      const chapterTitle = doc.relativePath.split('/').pop() ?? doc.relativePath
      const safeChapterTitle = chapterTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      const contentHtml = await marked(normalize(doc.content))
      const cls = needsPageBreak ? 'page-break chapter' : 'chapter'
      bodyHtml += `<div class="${cls}"><h2>${safeChapterTitle}</h2>${contentHtml}</div>`
      needsPageBreak = true
    }

    const safeTitle = projectName.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
    const headerTitle = projectName.toUpperCase().replace(/</g, '&lt;').replace(/>/g, '&gt;')

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
  @page { size: letter; margin: 1in; }
  body { font-family: "Courier New", Courier, monospace; font-size: 12pt; line-height: 2; color: #000; margin: 0; padding: 0; }
  h1, h2, h3 { font-weight: normal; font-size: 12pt; text-align: center; text-transform: uppercase; margin: 0; line-height: 2; }
  p { margin: 0; text-indent: 0.5in; text-align: left; }
  h1 + p, h2 + p, h3 + p, hr + p, .chapter > p:first-child { text-indent: 0; }
  hr { border: none; margin: 0; height: 2em; text-align: center; }
  hr::after { content: "#"; display: block; text-align: center; line-height: 2; }
  em { font-style: italic; }
  strong { font-weight: bold; }
  blockquote { margin: 0 0 0 0.5in; }
  ul, ol { margin: 0 0 0 0.5in; }
  li { margin: 0; }
  .page-break { page-break-before: always; }
  .chapter { padding-top: 2.5in; }
  .chapter:first-child { padding-top: 0; }
  .part-page { padding-top: 3.5in; text-align: center; }
  .part-title { font-family: "Courier New", Courier, monospace; font-size: 12pt; text-transform: uppercase; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`

    const tempPath = join(tmpdir(), `hohoff-project-export-${Date.now()}.html`)
    writeFileSync(tempPath, html, 'utf-8')

    const offscreen = new BrowserWindow({ show: false, webPreferences: { sandbox: false, contextIsolation: true } })
    try {
      await offscreen.loadFile(tempPath)
      const pdfBuffer = await offscreen.webContents.printToPDF({
        pageSize: 'Letter',
        displayHeaderFooter: true,
        headerTemplate: `<div style="font-size:11pt;font-family:'Courier New',Courier,monospace;width:100%;text-align:right;padding-right:72pt;">${headerTitle} / <span class="pageNumber"></span></div>`,
        footerTemplate: '<div></div>',
        margins: { marginType: 'custom', top: 1.25, bottom: 1.0, left: 1.0, right: 1.0 }
      })
      writeFileSync(result.filePath, pdfBuffer)
    } finally {
      offscreen.destroy()
      try { unlinkSync(tempPath) } catch { /* ignore */ }
    }
  })
}
