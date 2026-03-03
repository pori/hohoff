import { useEffect, useRef, useState, useCallback } from 'react'
import { useEditorStore } from '../../store/editorStore'
import type { SearchFileResult } from '../../types/editor'
import './ProjectSearch.css'

interface SearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  isRegex: boolean
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildMatchLine(lineText: string, matchStart: number, matchEnd: number): string {
  const before = escapeHtml(lineText.slice(0, matchStart))
  const match = escapeHtml(lineText.slice(matchStart, matchEnd))
  const after = escapeHtml(lineText.slice(matchEnd))
  return `${before}<mark>${match}</mark>${after}`
}

interface FileGroupProps {
  result: SearchFileResult
  hasReplace: boolean
  onMatchClick: (filePath: string, lineNumber: number) => void
  onFileReplace: (filePath: string) => void
}

function FileGroup({ result, hasReplace, onMatchClick, onFileReplace }: FileGroupProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const matchWord = result.matches.length === 1 ? 'match' : 'matches'

  return (
    <div className="ps-file-group">
      <div className="ps-file-header" onClick={() => setCollapsed((v) => !v)}>
        <span className="ps-chevron">{collapsed ? '▶' : '▼'}</span>
        <span className="ps-file-name" title={result.relativePath}>{result.relativePath}</span>
        <span className="ps-match-count">{result.matches.length} {matchWord}</span>
        {hasReplace && (
          <button
            className="ps-file-replace-btn"
            onClick={(e) => { e.stopPropagation(); onFileReplace(result.filePath) }}
            title={`Replace in ${result.relativePath}`}
          >
            Replace
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="ps-matches">
          {result.matches.map((match, idx) => (
            <div
              key={idx}
              className="ps-match-row"
              onClick={() => onMatchClick(result.filePath, match.lineNumber)}
              title={`Line ${match.lineNumber}: ${match.lineText.trim()}`}
            >
              <span className="ps-line-num">{match.lineNumber}</span>
              <span
                className="ps-line-text"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: buildMatchLine(match.lineText, match.matchStart, match.matchEnd) }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ProjectSearchModal(): JSX.Element | null {
  const { projectSearchOpen, closeProjectSearch, setActiveFile, scrollEditorToLine, activeFilePath } = useEditorStore()

  const [query, setQuery] = useState('')
  const [replaceValue, setReplaceValue] = useState('')
  const [opts, setOpts] = useState<SearchOptions>({ caseSensitive: false, wholeWord: false, isRegex: false })
  const [results, setResults] = useState<SearchFileResult[]>([])
  const [regexError, setRegexError] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)

  const searchInputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Focus search input when modal opens
  useEffect(() => {
    if (projectSearchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 30)
    } else {
      setResults([])
      setRegexError(null)
    }
  }, [projectSearchOpen])

  // Run search with debounce
  const runSearch = useCallback((q: string, options: SearchOptions) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) {
      setResults([])
      setRegexError(null)
      return
    }
    debounceRef.current = setTimeout(async () => {
      // Validate regex if enabled
      if (options.isRegex) {
        try {
          new RegExp(q)
        } catch (e) {
          setRegexError(e instanceof Error ? e.message : 'Invalid regex')
          setResults([])
          return
        }
      }
      setRegexError(null)
      setIsSearching(true)
      try {
        const found = await window.api.searchFiles(q, options)
        setResults(found)
      } catch {
        setResults([])
      } finally {
        setIsSearching(false)
      }
    }, 150)
  }, [])

  const handleQueryChange = (value: string): void => {
    setQuery(value)
    runSearch(value, opts)
  }

  const toggleOpt = (key: keyof SearchOptions): void => {
    const next = { ...opts, [key]: !opts[key] }
    setOpts(next)
    runSearch(query, next)
  }

  const handleMatchClick = async (filePath: string, lineNumber: number): Promise<void> => {
    closeProjectSearch()
    if (filePath !== activeFilePath) {
      const content = await window.api.readFile(filePath)
      setActiveFile(filePath, content)
    }
    // Small delay to let the editor mount/settle before scrolling
    setTimeout(() => scrollEditorToLine(lineNumber), 50)
  }

  const doReplace = async (filePaths: string[]): Promise<void> => {
    if (!query.trim()) return
    const modified = await window.api.replaceInFiles(query, replaceValue, opts, filePaths)
    if (modified.length > 0) {
      // Re-run search to refresh results
      const found = await window.api.searchFiles(query, opts)
      setResults(found)
      // Reload active file if it was modified
      if (activeFilePath && modified.includes(activeFilePath)) {
        const content = await window.api.readFile(activeFilePath)
        setActiveFile(activeFilePath, content)
      }
    }
  }

  const handleReplaceAll = (): void => {
    const allPaths = results.map((r) => r.filePath)
    doReplace(allPaths)
  }

  const handleFileReplace = (filePath: string): void => {
    doReplace([filePath])
  }

  // Keyboard: Escape closes
  useEffect(() => {
    if (!projectSearchOpen) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeProjectSearch()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [projectSearchOpen, closeProjectSearch])

  if (!projectSearchOpen) return null

  const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0)
  const hasReplace = replaceValue !== '' || false // show replace buttons whenever replace field has content

  return (
    <div className="ps-backdrop" onClick={(e) => { if (e.target === e.currentTarget) closeProjectSearch() }}>
      <div className="ps-modal">
        <div className="ps-header">
          {/* Search row */}
          <div className="ps-row">
            <input
              ref={searchInputRef}
              className="ps-input"
              placeholder="Search across all files…"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              spellCheck={false}
            />
            <button
              className={`ps-opt${opts.caseSensitive ? ' active' : ''}`}
              onClick={() => toggleOpt('caseSensitive')}
              title="Match case"
            >Aa</button>
            <button
              className={`ps-opt${opts.wholeWord ? ' active' : ''}`}
              onClick={() => toggleOpt('wholeWord')}
              title="Match whole word"
            >W</button>
            <button
              className={`ps-opt${opts.isRegex ? ' active' : ''}`}
              onClick={() => toggleOpt('isRegex')}
              title="Use regular expression"
            >.*</button>
            <button className="ps-close" onClick={closeProjectSearch} title="Close (Esc)">×</button>
          </div>
          {/* Replace row */}
          <div className="ps-row">
            <input
              className="ps-input"
              placeholder="Replace with…"
              value={replaceValue}
              onChange={(e) => setReplaceValue(e.target.value)}
              spellCheck={false}
            />
            <button
              className="ps-replace-btn"
              onClick={handleReplaceAll}
              disabled={results.length === 0 || !query.trim()}
              title="Replace all matches across all files"
            >
              Replace All
            </button>
          </div>
        </div>

        <div className="ps-results">
          {regexError ? (
            <div className="ps-empty">Invalid regex: {regexError}</div>
          ) : isSearching ? (
            <div className="ps-empty">Searching…</div>
          ) : query.trim() && results.length === 0 ? (
            <div className="ps-empty">No results</div>
          ) : results.length > 0 ? (
            results.map((r) => (
              <FileGroup
                key={r.filePath}
                result={r}
                hasReplace={hasReplace}
                onMatchClick={handleMatchClick}
                onFileReplace={handleFileReplace}
              />
            ))
          ) : null}
        </div>

        <div className="ps-footer">
          {regexError ? (
            <span className="ps-error">Regex error</span>
          ) : (
            <span className="ps-stats">
              {query.trim() && !isSearching
                ? totalMatches > 0
                  ? `${totalMatches} match${totalMatches === 1 ? '' : 'es'} in ${results.length} file${results.length === 1 ? '' : 's'}`
                  : ''
                : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
