import { readdir, readFile, writeFile, mkdir, unlink, rename as fsRename, rm } from 'fs/promises'
import { join, dirname, basename } from 'path'
import type { FileNode, RevisionMeta } from '../renderer/types/editor'

const DRAFT_ROOT =
  process.env.DRAFT_PATH ?? '/Users/pori/WebstormProjects/hohoff/draft'

const ORDER_FILE = join(DRAFT_ROOT, '.order.json')
const SESSION_FILE = join(DRAFT_ROOT, '.session.json')
const REVISIONS_DIR = join(DRAFT_ROOT, '.revisions')

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
    return JSON.parse(await readFile(ORDER_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

export async function saveOrderFile(order: Record<string, string[]>): Promise<void> {
  await writeFile(ORDER_FILE, JSON.stringify(order, null, 2), 'utf-8')
}

export async function readSession(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(SESSION_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

export async function writeSession(data: Record<string, unknown>): Promise<void> {
  await writeFile(SESSION_FILE, JSON.stringify(data), 'utf-8')
}

function applyOrder(nodes: FileNode[], savedNames: string[]): FileNode[] {
  const map = new Map(nodes.map((n) => [n.name, n]))
  const ordered = savedNames.filter((n) => map.has(n)).map((n) => map.get(n)!)
  const rest = nodes.filter((n) => !savedNames.includes(n.name))
  return [...ordered, ...rest]
}

export async function listDraftFiles(): Promise<FileNode[]> {
  const [entries, order] = await Promise.all([
    readdir(DRAFT_ROOT, { withFileTypes: true }),
    readOrderFile()
  ])
  const nodes: FileNode[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = join(DRAFT_ROOT, entry.name)

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
  const resolved = filePath.startsWith('/') ? filePath : join(DRAFT_ROOT, filePath)
  if (!resolved.startsWith(DRAFT_ROOT)) {
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
  const paths = await collectMarkdownPaths(DRAFT_ROOT)
  let total = 0
  for (const p of paths) {
    const content = await readFile(p, 'utf-8')
    total += countWords(content)
  }
  return total
}

// ─── Revision system ─────────────────────────────────────────────────────────

function revisionSlug(filePath: string): string {
  const prefix = DRAFT_ROOT + '/'
  const rel = filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath
  return rel.replace(/\.md$/, '').replace(/\//g, '__')
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 7)
}

export async function saveRevision(filePath: string, content: string): Promise<void> {
  assertInDraftRoot(filePath)
  const slug = revisionSlug(filePath)
  const dir = join(REVISIONS_DIR, slug)
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
  const dir = join(REVISIONS_DIR, slug)
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
  const revPath = join(REVISIONS_DIR, slug, `${revisionId}.json`)
  const raw = JSON.parse(await readFile(revPath, 'utf-8')) as { content: string }
  return raw.content
}

export async function deleteRevision(filePath: string, revisionId: string): Promise<void> {
  assertInDraftRoot(filePath)
  if (!/^[\w-]+$/.test(revisionId)) throw new Error('Invalid revision ID')
  const slug = revisionSlug(filePath)
  const revPath = join(REVISIONS_DIR, slug, `${revisionId}.json`)
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
  const dir = parentPath === '__root__' ? DRAFT_ROOT : parentPath
  assertInDraftRoot(dir)
  const filePath = join(dir, `${name}.md`)
  assertInDraftRoot(filePath)
  await writeFile(filePath, '', 'utf-8')
  return filePath
}

export async function createSubdirectory(parentPath: string, name: string): Promise<string> {
  const parent = parentPath === '__root__' ? DRAFT_ROOT : parentPath
  assertInDraftRoot(parent)
  const newDir = join(parent, name)
  assertInDraftRoot(newDir)
  await mkdir(newDir, { recursive: true })
  return newDir
}

export async function moveFileOrDir(sourcePath: string, targetDirPath: string): Promise<string> {
  assertInDraftRoot(sourcePath)
  const destDir = targetDirPath === '__root__' ? DRAFT_ROOT : targetDirPath
  assertInDraftRoot(destDir)
  const newPath = join(destDir, basename(sourcePath))
  assertInDraftRoot(newPath)
  if (newPath === sourcePath) return sourcePath
  await fsRename(sourcePath, newPath)
  return newPath
}
