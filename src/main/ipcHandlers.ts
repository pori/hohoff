import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, unlinkSync } from 'fs'
import { extname, basename, join } from 'path'
import { tmpdir } from 'os'
import { listDraftFiles, readMarkdownFile, writeMarkdownFile, getProjectWordCount, saveOrderFile, readSession, writeSession, saveRevision, listRevisions, loadRevision, deleteRevision, renameFileOrDir, deleteFileOrDir, createMarkdownFile, createSubdirectory, moveFileOrDir, readStoryBibleFile, openStoryBibleFile, writeStoryBibleFile, searchAcrossFiles, replaceInFiles, readAllDraftFiles, readProjectConfig, writeProjectConfig, PROJECT_CONFIG_FIELDS, readTelemetry } from './fileSystem'
import type { SearchOptions, ProjectConfig } from './fileSystem'
import { streamMessage, resetClient } from './aiService'
import { onWordSnapshot, flushTelemetry } from './telemetry'
import type { AIPayload, Attachment } from '../renderer/types/editor'
import { readGlobalConfig, writeGlobalConfig, getProjectTitle, addRecentProject, updateRecentProjectTitle } from './globalConfig'
import type { GlobalConfig } from './globalConfig'

type MergedConfig = GlobalConfig & ProjectConfig

let _onProjectChanged: (() => void) | null = null

export function setOnProjectChanged(cb: () => void): void {
  _onProjectChanged = cb
}

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

  ipcMain.handle('fs:readAllFiles', async () => {
    return await readAllDraftFiles()
  })

  ipcMain.handle('telemetry:wordSnapshot', (_event, filePath: string, wordCount: number) => {
    onWordSnapshot(filePath, wordCount)
  })

  ipcMain.handle('telemetry:flush', () => {
    flushTelemetry()
  })

  ipcMain.handle('telemetry:read', async () => {
    return await readTelemetry()
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

  ipcMain.handle('config:read', async (): Promise<MergedConfig> => {
    const global = readGlobalConfig()
    const project = await readProjectConfig()

    // One-time migration: if global has project fields, move them to project config
    const legacyGlobal = global as Record<string, unknown>
    const migrationFields = PROJECT_CONFIG_FIELDS.filter((f) => legacyGlobal[f] !== undefined)
    if (migrationFields.length > 0 && Object.keys(project).length === 0) {
      const migrated: Partial<ProjectConfig> = {}
      for (const f of migrationFields) {
        (migrated as Record<string, unknown>)[f] = legacyGlobal[f]
      }
      await writeProjectConfig(migrated)
      // Remove from global config
      const cleaned = { ...legacyGlobal }
      for (const f of migrationFields) delete cleaned[f]
      writeGlobalConfig(cleaned as Partial<GlobalConfig>)
      return { ...global, ...migrated }
    }

    return { ...global, ...project }
  })

  ipcMain.handle('config:write', async (_event, updates: Partial<MergedConfig>): Promise<void> => {
    const globalUpdates: Partial<GlobalConfig> = {}
    const projectUpdates: Partial<ProjectConfig> = {}

    for (const [key, value] of Object.entries(updates)) {
      if ((PROJECT_CONFIG_FIELDS as string[]).includes(key)) {
        (projectUpdates as Record<string, unknown>)[key] = value
      } else {
        (globalUpdates as Record<string, unknown>)[key] = value
      }
    }

    if (Object.keys(globalUpdates).length > 0) writeGlobalConfig(globalUpdates)
    if (Object.keys(projectUpdates).length > 0) await writeProjectConfig(projectUpdates)

    if (updates.apiKey !== undefined) resetClient()

    if (updates.projectPath) {
      const projectCfg = await readProjectConfig()
      const { basename } = require('path') as typeof import('path')
      addRecentProject(updates.projectPath, projectCfg.projectTitle?.trim() || basename(updates.projectPath))
      _onProjectChanged?.()
    } else if (updates.projectTitle !== undefined) {
      const currentPath = readGlobalConfig().projectPath
      if (currentPath) {
        const { basename } = require('path') as typeof import('path')
        updateRecentProjectTitle(currentPath, updates.projectTitle.trim() || basename(currentPath))
        _onProjectChanged?.()
      }
    }
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
    const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib')
    // Draft files use single \n between paragraphs; marked needs \n\n to create <p> elements
    const normalized = content.replace(/\r\n/g, '\n').replace(/\n(?!\n)/g, '\n\n')
    const bodyHtml = await marked(normalized)

    const safeTitle = fileName.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
    const projectCfgForPdf = await readProjectConfig()
    const projectTitle = getProjectTitle(projectCfgForPdf.projectTitle).toUpperCase()
    const chapterTitle = fileName.toUpperCase()

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
  @page { size: letter; }
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
        displayHeaderFooter: false,
        margins: { marginType: 'custom', top: 1.0, bottom: 1.0, left: 1.0, right: 1.0 }
      })

      // Stamp the running header on every page using pdf-lib
      const pdfDoc = await PDFDocument.load(pdfBuffer)
      const courier = await pdfDoc.embedFont(StandardFonts.Courier)
      const pages = pdfDoc.getPages()
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i]
        const { width, height } = page.getSize()
        const headerText = `${projectTitle} / ${chapterTitle} / ${i + 1}`
        const fontSize = 11
        const textWidth = courier.widthOfTextAtSize(headerText, fontSize)
        page.drawText(headerText, {
          x: width - 72 - textWidth,  // 1 in from right edge
          y: height - 36,             // 0.5 in from top edge
          size: fontSize,
          font: courier,
          color: rgb(0, 0, 0)
        })
      }

      const pdfBytes = await pdfDoc.save()
      writeFileSync(result.filePath, pdfBytes)
    } finally {
      offscreen.destroy()
      try { unlinkSync(tempPath) } catch { /* ignore */ }
    }
  })

  ipcMain.handle('export:projectPdf', async (event, opts: {
    romanNumerals: boolean
    showChapterTitle: boolean
    includeCover: boolean
    includeFrontMatter: boolean
    pageFrom: number | null
    pageTo: number | null
  }): Promise<void> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const projectCfg = await readProjectConfig()
    const projectName = getProjectTitle(projectCfg.projectTitle)

    const result = await dialog.showSaveDialog(win!, {
      defaultPath: `${projectName}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return

    const docs = await readAllDraftFiles()
    if (docs.length === 0) return

    const { marked } = await import('marked')
    const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib')
    const normalize = (s: string) => s.replace(/\r\n/g, '\n').replace(/\n(?!\n)/g, '\n\n')
    const esc = (s: string): string =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    const projectTitle = projectName.toUpperCase()

    // ── Cover page ──────────────────────────────────────────────────────────────
    const authorLegal  = projectCfg.authorName?.trim()  ?? ''
    const authorByline = projectCfg.penName?.trim()      || authorLegal
    const authorAddr   = projectCfg.authorAddress?.trim() ?? ''
    const authorEmail  = projectCfg.authorEmail?.trim()  ?? ''
    const authorPhone  = projectCfg.authorPhone?.trim()  ?? ''

    // Count words from docs already in memory, rounded to nearest 1,000
    const totalWords = docs.reduce((sum, doc) => {
      return sum + (doc.content.trim() === '' ? 0 : doc.content.trim().split(/\s+/).length)
    }, 0)
    const roundTo     = totalWords >= 5000 ? 1000 : 100
    const rounded     = Math.round(totalWords / roundTo) * roundTo
    const wordCountText = `~${rounded.toLocaleString('en-US')} words`

    // Author contact block (skip empty lines)
    const contactLines = [
      authorLegal,
      ...authorAddr.split('\n').map(l => l.trim()).filter(Boolean),
      authorPhone,
      authorEmail,
    ].filter(Boolean)

    const coverCSS = `
      @page { size: letter; }
      body {
        font-family: "Courier New", Courier, monospace;
        font-size: 12pt;
        line-height: 1.5;
        color: #000;
        margin: 0;
        padding: 0;
      }
      .cover-page {
        display: flex;
        flex-direction: column;
        height: 9in;
      }
      .cover-top {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
      }
      .cover-contact { line-height: 1.5; }
      .cover-wordcount { text-align: right; line-height: 1.5; }
      .cover-title-block {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        text-align: center;
        line-height: 2;
      }
      .cover-title { font-size: 12pt; text-transform: uppercase; margin: 0; }
      .cover-by    { margin: 0; }
      .cover-byline{ margin: 0; }
    `
    const coverBodyHtml = `
      <div class="cover-page">
        <div class="cover-top">
          <div class="cover-contact">${contactLines.map(esc).join('<br>')}</div>
          <div class="cover-wordcount">${esc(wordCountText)}</div>
        </div>
        <div class="cover-title-block">
          <p class="cover-title">${esc(projectName)}</p>
          ${authorByline ? `<p class="cover-by">by</p><p class="cover-byline">${esc(authorByline)}</p>` : ''}
        </div>
      </div>`

    // Build an ordered list of sections: cover + part-divider pages + individual chapters.
    // Each section becomes its own PDF so its title can appear in the running header.
    // isCover=true sections receive no running header (standard manuscript practice).
    interface Section { title: string; bodyHtml: string; css?: string; isCover?: boolean }
    const sections: Section[] = []

    if (opts.includeCover) {
      sections.push({ title: '', bodyHtml: coverBodyHtml, css: coverCSS, isCover: true })
    }

    const toRoman = (n: number): string => {
      const vals = [1000,900,500,400,100,90,50,40,10,9,5,4,1]
      const syms = ['M','CM','D','CD','C','XC','L','XL','X','IX','V','IV','I']
      let result = ''
      for (let i = 0; i < vals.length; i++) {
        while (n >= vals[i]) { result += syms[i]; n -= vals[i] }
      }
      return result
    }

    // Front matter = docs not inside a subdirectory (no slash in relativePath)
    // Body chapters = docs inside a Part subdirectory
    let currentPart: string | null = null
    let chapterIndex = 0

    for (const doc of docs) {
      const slashIdx = doc.relativePath.indexOf('/')
      const partName = slashIdx !== -1 ? doc.relativePath.slice(0, slashIdx) : null
      const isFrontMatter = partName === null

      if (isFrontMatter && !opts.includeFrontMatter) continue

      if (partName !== null && partName !== currentPart) {
        currentPart = partName
        const safe = partName.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        sections.push({
          title: partName,
          bodyHtml: `<div class="part-page"><div class="part-title">${safe}</div></div>`
        })
      }

      const fileName = doc.relativePath.split('/').pop()?.replace(/\.md$/, '') ?? doc.relativePath
      let headerTitle: string
      let headingHtml: string
      if (!isFrontMatter) {
        chapterIndex++
        const numeral = opts.romanNumerals ? toRoman(chapterIndex) : null
        const title = opts.showChapterTitle ? fileName : null
        const safe = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        if (numeral && title) {
          headingHtml = `<h2>${safe(numeral)}</h2><h3>${safe(title)}</h3>`
          headerTitle = `${numeral} — ${title}`
        } else if (numeral) {
          headingHtml = `<h2>${safe(numeral)}</h2>`
          headerTitle = numeral
        } else if (title) {
          headingHtml = `<h2>${safe(title)}</h2>`
          headerTitle = title
        } else {
          headingHtml = ''
          headerTitle = fileName
        }
      } else {
        headingHtml = `<h2>${fileName.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</h2>`
        headerTitle = fileName
      }
      const contentHtml = await marked(normalize(doc.content))
      sections.push({
        title: headerTitle,
        bodyHtml: `<div class="chapter">${headingHtml}${contentHtml}</div>`
      })
    }

    // CSS shared by chapter/part sections — cover page uses its own CSS (set above).
    const pageCSS = `
      @page { size: letter; }
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
      .chapter { padding-top: 2.5in; }
      .part-page { padding-top: 3.5in; text-align: center; }
      .part-title { font-family: "Courier New", Courier, monospace; font-size: 12pt; text-transform: uppercase; }
    `

    // Print each section to its own PDF buffer. Cover page uses its own CSS;
    // chapters/parts use the shared pageCSS. No built-in browser header/footer —
    // we stamp running headers ourselves with pdf-lib so the title varies per section.
    const sectionPdfs: { title: string; buffer: Uint8Array; isCover: boolean }[] = []

    for (const section of sections) {
      const css = section.css ?? pageCSS
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${section.bodyHtml}</body></html>`
      const tempPath = join(tmpdir(), `hohoff-section-${Date.now()}-${Math.round(Math.random() * 1e9)}.html`)
      writeFileSync(tempPath, html, 'utf-8')
      const offscreen = new BrowserWindow({ show: false, webPreferences: { sandbox: false, contextIsolation: true } })
      try {
        await offscreen.loadFile(tempPath)
        const buf = await offscreen.webContents.printToPDF({
          pageSize: 'Letter',
          displayHeaderFooter: false,
          margins: { marginType: 'custom', top: 1.0, bottom: 1.0, left: 1.0, right: 1.0 }
        })
        sectionPdfs.push({ title: section.title, buffer: buf, isCover: section.isCover ?? false })
      } finally {
        offscreen.destroy()
        try { unlinkSync(tempPath) } catch { /* ignore */ }
      }
    }

    // Merge all section PDFs into one document, tracking which section each page
    // belongs to so we can stamp the correct running header on it.
    const mergedPdf = await PDFDocument.create()
    const courier = await mergedPdf.embedFont(StandardFonts.Courier)
    // pageOwners[i] tracks the section title and whether the page is a cover page
    const pageOwners: { title: string; isCover: boolean }[] = []

    for (const { title, buffer, isCover } of sectionPdfs) {
      const srcPdf = await PDFDocument.load(buffer)
      const copied = await mergedPdf.copyPages(srcPdf, srcPdf.getPageIndices())
      for (const page of copied) {
        mergedPdf.addPage(page)
        pageOwners.push({ title, isCover })
      }
    }

    // Stamp the running header on body pages only (cover page gets no header).
    // Page numbers count from 1 starting with the first non-cover page.
    const allPages = mergedPdf.getPages()
    let bodyPageNum = 0
    for (let i = 0; i < allPages.length; i++) {
      if (pageOwners[i].isCover) continue   // no header/number on cover page
      bodyPageNum++
      const page = allPages[i]
      const { width, height } = page.getSize()
      const chapterUpper = pageOwners[i].title.toUpperCase()
      const headerText = `${projectTitle} / ${chapterUpper} / ${bodyPageNum}`
      const fontSize = 11
      const textWidth = courier.widthOfTextAtSize(headerText, fontSize)
      page.drawText(headerText, {
        x: width - 72 - textWidth,   // 1 in from right edge (72pt = 1in)
        y: height - 36,              // 0.5 in from top edge (36pt = 0.5in)
        size: fontSize,
        font: courier,
        color: rgb(0, 0, 0)
      })
    }

    // Apply page range if requested. Page numbers are body-page numbers (cover excluded).
    // We build a final document containing only the requested pages.
    let finalPdf = mergedPdf
    if (opts.pageFrom !== null || opts.pageTo !== null) {
      const rangeDoc = await PDFDocument.create()
      const rangePages = mergedPdf.getPages()
      let bodyNum = 0
      const indicesToKeep: number[] = []
      for (let i = 0; i < rangePages.length; i++) {
        if (!pageOwners[i].isCover) bodyNum++
        const inRange =
          (opts.pageFrom === null || bodyNum >= opts.pageFrom) &&
          (opts.pageTo === null || bodyNum <= opts.pageTo)
        if (pageOwners[i].isCover || inRange) indicesToKeep.push(i)
      }
      const copied = await rangeDoc.copyPages(mergedPdf, indicesToKeep)
      for (const p of copied) rangeDoc.addPage(p)
      finalPdf = rangeDoc
    }

    const pdfBytes = await finalPdf.save()
    writeFileSync(result.filePath, pdfBytes)
  })
}
