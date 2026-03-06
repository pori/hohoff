import { join } from 'path'
import { homedir } from 'os'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

export interface GlobalConfig {
  apiKey?: string
  projectPath?: string
}

const CONFIG_DIR = join(homedir(), '.hohoff')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

let _config: GlobalConfig = {}

try {
  _config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
} catch {
  // first run or file missing — use fallbacks
}

export const getConfigDir = (): string => CONFIG_DIR

export const getDraftRoot = (): string =>
  _config.projectPath ?? process.env.DRAFT_PATH ?? '/Users/pori/WebstormProjects/hohoff/draft'

export const getApiKey = (): string | undefined =>
  _config.apiKey ?? process.env.ANTHROPIC_API_KEY

export function readGlobalConfig(): GlobalConfig {
  return { ..._config }
}

export function writeGlobalConfig(updates: Partial<GlobalConfig>): void {
  _config = { ..._config, ...updates }
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(_config, null, 2), 'utf-8')
}
