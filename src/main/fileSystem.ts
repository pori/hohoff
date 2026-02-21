import { readdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { FileNode } from '../renderer/types/editor'

const DRAFT_ROOT =
  process.env.DRAFT_PATH ?? '/Users/pori/WebstormProjects/hohoff/draft'

const ORDER_FILE = join(DRAFT_ROOT, '.order.json')

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
