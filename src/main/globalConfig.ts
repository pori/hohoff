import { join, basename } from 'path'
import { homedir } from 'os'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

export interface RecentProject {
  path: string
  title: string
}

export interface GlobalConfig {
  apiKey?: string
  projectPath?: string
  theme?: 'dark' | 'light'
  recentProjects?: RecentProject[]
}

const CONFIG_DIR = join(homedir(), '.hohoff')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

let _config: GlobalConfig = {}

try {
  const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
  // Migrate old string[] recentProjects to RecentProject[]
  if (Array.isArray(raw.recentProjects) && typeof raw.recentProjects[0] === 'string') {
    raw.recentProjects = (raw.recentProjects as string[]).map((p) => ({ path: p, title: basename(p) }))
  }
  _config = raw
} catch {
  // first run or file missing — use fallbacks
}

export const getConfigDir = (): string => CONFIG_DIR

export const getDraftRoot = (): string =>
  _config.projectPath ?? process.env.DRAFT_PATH ?? join(homedir(), 'Documents', 'hohoff-draft')

export const getApiKey = (): string | undefined =>
  _config.apiKey ?? process.env.ANTHROPIC_API_KEY

export const getProjectTitle = (projectTitle?: string): string =>
  projectTitle?.trim() || basename(getDraftRoot())

export function readGlobalConfig(): GlobalConfig {
  return { ..._config }
}

export function writeGlobalConfig(updates: Partial<GlobalConfig>): void {
  _config = { ..._config, ...updates }
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(_config, null, 2), 'utf-8')
}

export function addRecentProject(path: string, title: string): void {
  const existing = _config.recentProjects ?? []
  const deduped = [{ path, title }, ...existing.filter((p) => p.path !== path)].slice(0, 10)
  writeGlobalConfig({ recentProjects: deduped })
}

export function updateRecentProjectTitle(path: string, title: string): void {
  const existing = _config.recentProjects ?? []
  const updated = existing.map((p) => p.path === path ? { path, title } : p)
  writeGlobalConfig({ recentProjects: updated })
}

export function getRecentProjects(): RecentProject[] {
  return _config.recentProjects ?? []
}
