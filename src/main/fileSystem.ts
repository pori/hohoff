import { readdir, readFile, writeFile, mkdir, unlink, rename as fsRename, rm } from 'fs/promises'
import { join, dirname, basename } from 'path'
import type { FileNode, RevisionMeta, SearchMatch, SearchFileResult } from '../renderer/types/editor'
import { getDraftRoot } from './globalConfig'

const hohoffDir = (): string => join(getDraftRoot(), '.hohoff')
const orderFile = (): string => join(hohoffDir(), 'order.json')
const sessionFile = (): string => join(hohoffDir(), 'session.json')
const revisionsDir = (): string => join(hohoffDir(), 'revisions')
export const getStoryBiblePath = (): string => join(hohoffDir(), 'Story Bible.md')

const STORY_BIBLE_TEMPLATE = `# Story Bible

## Characters

<!-- Profile each character: role, appearance, personality, arc, key relationships -->

## World & Setting

<!-- The Basque Country: geography, historical period, cultural details, atmosphere -->

## Timeline

<!-- Key events in chronological order -->

## Themes & Motifs

<!-- Recurring symbols, imagery, thematic concerns -->

## Continuity Rules

<!-- Facts Claude must always respect: established plot points, internal logic, naming conventions -->
`

const MAX_REVISIONS = 50

const PART_ORDER = ['Prologue', 'Content Warning', 'Part I', 'Part II', 'Part III', 'Part IV', 'Epilogue', 'The first time']

function sortDraftNodes(a: FileNode, b: FileNode): number {
  const aIdx = PART_ORDER.findIndex((o) => a.name.startsWith(o))
  const bIdx = PART_ORDER.findIndex((o) => b.name.startsWith(o))
  if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx
  if (aIdx !== -1) return -1
  if (bIdx !== -1) return 1
  return a.name.localeCompare(b.name)
}

async function readOrderFile(): Promise<Record<string, string[]>> {
  try {
    return JSON.parse(await readFile(orderFile(), 'utf-8'))
  } catch {
    return {}
  }
}

export async function saveOrderFile(order: Record<string, string[]>): Promise<void> {
  await mkdir(hohoffDir(), { recursive: true })
  await writeFile(orderFile(), JSON.stringify(order, null, 2), 'utf-8')
}

export async function readSession(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(sessionFile(), 'utf-8'))
  } catch {
    return {}
  }
}

export async function writeSession(data: Record<string, unknown>): Promise<void> {
  await mkdir(hohoffDir(), { recursive: true })
  await writeFile(sessionFile(), JSON.stringify(data), 'utf-8')
}

function applyOrder(nodes: FileNode[], savedNames: string[]): FileNode[] {
  const map = new Map(nodes.map((n) => [n.name, n]))
  const ordered = savedNames.filter((n) => map.has(n)).map((n) => map.get(n)!)
  const rest = nodes.filter((n) => !savedNames.includes(n.name))
  return [...ordered, ...rest]
}

export async function listDraftFiles(): Promise<FileNode[]> {
  const [entries, order] = await Promise.all([
    readdir(getDraftRoot(), { withFileTypes: true }),
    readOrderFile()
  ])
  const nodes: FileNode[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = join(getDraftRoot(), entry.name)

    if (entry.isDirectory()) {
      const children = await readdir(fullPath, { withFileTypes: true })
      let childNodes: FileNode[] = children
        .filter((c) => c.name.endsWith('.md') && !c.name.startsWith('.'))
        .map((c) => ({
          name: c.name.replace(/\.md$/, ''),
          path: join(fullPath, c.name),
          type: 'file' as const
        }))

      if (order[fullPath]) {
        childNodes = applyOrder(childNodes, order[fullPath])
      } else {
        childNodes = childNodes.sort((a, b) => a.name.localeCompare(b.name))
      }

      nodes.push({
        name: entry.name,
        path: fullPath,
        type: 'directory',
        children: childNodes
      })
    } else if (entry.name.endsWith('.md')) {
      nodes.push({
        name: entry.name.replace(/\.md$/, ''),
        path: fullPath,
        type: 'file'
      })
    }
  }

  if (order['__root__']) {
    return applyOrder(nodes, order['__root__'])
  }
  return nodes.sort(sortDraftNodes)
}

function assertInDraftRoot(filePath: string): void {
  const draftRoot = getDraftRoot()
  const resolved = filePath.startsWith('/') ? filePath : join(draftRoot, filePath)
  if (!resolved.startsWith(draftRoot)) {
    throw new Error('Access denied: path outside draft directory')
  }
}

export async function readMarkdownFile(filePath: string): Promise<string> {
  assertInDraftRoot(filePath)
  return await readFile(filePath, 'utf-8')
}

export async function writeMarkdownFile(filePath: string, content: string): Promise<void> {
  assertInDraftRoot(filePath)
  await writeFile(filePath, content, 'utf-8')
}

function countWords(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length
}

export interface DraftDocument {
  path: string
  relativePath: string // e.g. "Part I/Chapter 1"
  content: string
}

function flattenFileNodes(nodes: FileNode[]): string[] {
  const paths: string[] = []
  for (const node of nodes) {
    if (node.type === 'file') paths.push(node.path)
    else if (node.children) paths.push(...flattenFileNodes(node.children))
  }
  return paths
}

export async function readAllDraftFiles(): Promise<DraftDocument[]> {
  const tree = await listDraftFiles()
  // Exclude Story Bible.md — it is injected separately via readStoryBibleFile()
  const paths = flattenFileNodes(tree).filter(p => p !== getStoryBiblePath())
  const prefix = getDraftRoot() + '/'
  return Promise.all(
    paths.map(async (p) => ({
      path: p,
      relativePath: (p.startsWith(prefix) ? p.slice(prefix.length) : p).replace(/\.md$/, ''),
      content: await readFile(p, 'utf-8')
    }))
  )
}

export async function openStoryBibleFile(): Promise<{ path: string; content: string }> {
  await mkdir(hohoffDir(), { recursive: true })
  let content: string
  try {
    content = await readFile(getStoryBiblePath(), 'utf-8')
  } catch {
    content = STORY_BIBLE_TEMPLATE
    await writeFile(getStoryBiblePath(), content, 'utf-8')
  }
  return { path: getStoryBiblePath(), content }
}

// Parse a markdown document into a preamble (text before first ## heading) and
// an ordered list of { header, body } sections delimited by ## headings.
function parseSections(content: string): { preamble: string; sections: { header: string; body: string }[] } {
  const lines = content.split('\n')
  const preamble: string[] = []
  const sections: { header: string; body: string[] }[] = []
  let current: { header: string; body: string[] } | null = null

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) sections.push({ header: current.header, body: current.body })
      current = { header: line, body: [] }
    } else if (current === null) {
      preamble.push(line)
    } else {
      current.body.push(line)
    }
  }
  if (current) sections.push({ header: current.header, body: current.body })

  return {
    preamble: preamble.join('\n').trimEnd(),
    sections: sections.map(s => ({ header: s.header, body: s.body.join('\n').trimEnd() }))
  }
}

// Merge incoming content into existing by ## section.
// Sections present in incoming replace the matching section in existing.
// New sections (in incoming but not existing) are appended.
// Sections only in existing are preserved unchanged.
export function mergeStoryBibleContent(existing: string, incoming: string): string {
  const { preamble, sections: existingSections } = parseSections(existing)
  const { sections: incomingSections } = parseSections(incoming)

  const updatedBodies = new Map(existingSections.map(s => [s.header, s.body]))
  const existingHeaders = new Set(existingSections.map(s => s.header))

  for (const { header, body } of incomingSections) {
    updatedBodies.set(header, body)
  }

  // Existing sections in original order (with updated bodies), then new ones
  const result: string[] = [preamble || '# Story Bible']
  for (const { header } of existingSections) {
    const body = updatedBodies.get(header) ?? ''
    result.push('', header)
    if (body) result.push('', body)
  }
  for (const { header, body } of incomingSections) {
    if (!existingHeaders.has(header)) {
      result.push('', header)
      if (body) result.push('', body)
    }
  }

  return result.join('\n') + '\n'
}

export async function writeStoryBibleFile(content: string): Promise<string> {
  await mkdir(hohoffDir(), { recursive: true })
  let existing: string
  try {
    existing = await readFile(getStoryBiblePath(), 'utf-8')
  } catch {
    existing = STORY_BIBLE_TEMPLATE
  }
  const merged = mergeStoryBibleContent(existing, content)
  await writeFile(getStoryBiblePath(), merged, 'utf-8')
  return merged
}

export async function readStoryBibleFile(): Promise<string | null> {
  try {
    return await readFile(getStoryBiblePath(), 'utf-8')
  } catch {
    return null
  }
}

async function collectMarkdownPaths(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const paths: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = await collectMarkdownPaths(fullPath)
      paths.push(...nested)
    } else if (entry.name.endsWith('.md')) {
      paths.push(fullPath)
    }
  }
  return paths
}

export async function getProjectWordCount(): Promise<number> {
  const paths = await collectMarkdownPaths(getDraftRoot())
  let total = 0
  for (const p of paths) {
    const content = await readFile(p, 'utf-8')
    total += countWords(content)
  }
  return total
}

// ─── Revision system ─────────────────────────────────────────────────────────

function revisionSlug(filePath: string): string {
  const prefix = getDraftRoot() + '/'
  const rel = filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath
  return rel.replace(/\.md$/, '').replace(/\//g, '__')
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 7)
}

export async function saveRevision(filePath: string, content: string): Promise<void> {
  assertInDraftRoot(filePath)
  const slug = revisionSlug(filePath)
  const dir = join(revisionsDir(), slug)
  await mkdir(dir, { recursive: true })
  const timestamp = Date.now()
  const id = `${timestamp}_${shortId()}`
  const revision = { id, timestamp, wordCount: countWords(content), content }
  await writeFile(join(dir, `${id}.json`), JSON.stringify(revision), 'utf-8')
  // Prune oldest revisions beyond the limit
  const entries = (await readdir(dir)).filter((e) => e.endsWith('.json')).sort()
  if (entries.length > MAX_REVISIONS) {
    await Promise.all(
      entries.slice(0, entries.length - MAX_REVISIONS).map((f) => unlink(join(dir, f)))
    )
  }
}

export async function listRevisions(filePath: string): Promise<RevisionMeta[]> {
  assertInDraftRoot(filePath)
  const slug = revisionSlug(filePath)
  const dir = join(revisionsDir(), slug)
  try {
    const entries = (await readdir(dir)).filter((e) => e.endsWith('.json')).sort().reverse()
    return await Promise.all(
      entries.map(async (f) => {
        const raw = JSON.parse(await readFile(join(dir, f), 'utf-8')) as {
          id: string
          timestamp: number
          wordCount: number
        }
        return { id: raw.id, timestamp: raw.timestamp, wordCount: raw.wordCount }
      })
    )
  } catch {
    return []
  }
}

export async function loadRevision(filePath: string, revisionId: string): Promise<string> {
  assertInDraftRoot(filePath)
  if (!/^[\w-]+$/.test(revisionId)) throw new Error('Invalid revision ID')
  const slug = revisionSlug(filePath)
  const revPath = join(revisionsDir(), slug, `${revisionId}.json`)
  const raw = JSON.parse(await readFile(revPath, 'utf-8')) as { content: string }
  return raw.content
}

export async function deleteRevision(filePath: string, revisionId: string): Promise<void> {
  assertInDraftRoot(filePath)
  if (!/^[\w-]+$/.test(revisionId)) throw new Error('Invalid revision ID')
  const slug = revisionSlug(filePath)
  const revPath = join(revisionsDir(), slug, `${revisionId}.json`)
  await unlink(revPath)
}

// ─── File tree mutations ──────────────────────────────────────────────────────

export async function renameFileOrDir(oldPath: string, newName: string): Promise<string> {
  assertInDraftRoot(oldPath)
  const isFile = oldPath.endsWith('.md')
  const newPath = join(dirname(oldPath), isFile ? `${newName}.md` : newName)
  assertInDraftRoot(newPath)
  await fsRename(oldPath, newPath)
  return newPath
}

export async function deleteFileOrDir(targetPath: string): Promise<void> {
  assertInDraftRoot(targetPath)
  await rm(targetPath, { recursive: true, force: true })
}

export async function createMarkdownFile(parentPath: string, name: string): Promise<string> {
  const dir = parentPath === '__root__' ? getDraftRoot() : parentPath
  assertInDraftRoot(dir)
  const filePath = join(dir, `${name}.md`)
  assertInDraftRoot(filePath)
  await writeFile(filePath, '', 'utf-8')
  return filePath
}

export async function createSubdirectory(parentPath: string, name: string): Promise<string> {
  const parent = parentPath === '__root__' ? getDraftRoot() : parentPath
  assertInDraftRoot(parent)
  const newDir = join(parent, name)
  assertInDraftRoot(newDir)
  await mkdir(newDir, { recursive: true })
  return newDir
}

export async function moveFileOrDir(sourcePath: string, targetDirPath: string): Promise<string> {
  assertInDraftRoot(sourcePath)
  const destDir = targetDirPath === '__root__' ? getDraftRoot() : targetDirPath
  assertInDraftRoot(destDir)
  const newPath = join(destDir, basename(sourcePath))
  assertInDraftRoot(newPath)
  if (newPath === sourcePath) return sourcePath
  await fsRename(sourcePath, newPath)
  return newPath
}

// ─── Project search/replace ───────────────────────────────────────────────────

export interface SearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  isRegex: boolean
}

function buildSearchRegex(query: string, opts: SearchOptions): RegExp {
  let pattern = opts.isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (opts.wholeWord) pattern = `\\b${pattern}\\b`
  const flags = opts.caseSensitive ? 'g' : 'gi'
  return new RegExp(pattern, flags)
}

function searchFileContent(content: string, regex: RegExp, filePath: string, relativePath: string): SearchFileResult | null {
  const lines = content.split('\n')
  const matches: SearchMatch[] = []
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i]
    regex.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = regex.exec(lineText)) !== null) {
      matches.push({
        lineNumber: i + 1,
        lineText,
        matchStart: m.index,
        matchEnd: m.index + m[0].length
      })
      if (!regex.global) break
    }
  }
  if (matches.length === 0) return null
  return { filePath, relativePath, matches }
}

export async function searchAcrossFiles(query: string, opts: SearchOptions): Promise<SearchFileResult[]> {
  if (!query) return []
  const regex = buildSearchRegex(query, opts)
  const docs = await readAllDraftFiles()
  const results: SearchFileResult[] = []

  for (const doc of docs) {
    const result = searchFileContent(doc.content, regex, doc.path, doc.relativePath)
    if (result) results.push(result)
  }

  // Also search the Story Bible
  const bibleContent = await readStoryBibleFile()
  if (bibleContent !== null) {
    const prefix = getDraftRoot() + '/'
    const storyBiblePath = getStoryBiblePath()
    const rel = (storyBiblePath.startsWith(prefix) ? storyBiblePath.slice(prefix.length) : storyBiblePath).replace(/\.md$/, '')
    const result = searchFileContent(bibleContent, regex, storyBiblePath, rel)
    if (result) results.push(result)
  }

  return results
}

export async function replaceInFiles(
  query: string,
  replacement: string,
  opts: SearchOptions,
  filePaths: string[]
): Promise<string[]> {
  if (!query) return []
  const regex = buildSearchRegex(query, opts)
  const modified: string[] = []
  for (const filePath of filePaths) {
    assertInDraftRoot(filePath)
    const original = await readFile(filePath, 'utf-8')
    regex.lastIndex = 0
    const updated = original.replace(regex, replacement)
    if (updated !== original) {
      await saveRevision(filePath, original)
      await writeFile(filePath, updated, 'utf-8')
      modified.push(filePath)
    }
  }
  return modified
}
