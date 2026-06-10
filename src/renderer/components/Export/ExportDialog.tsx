import { useEffect, useRef, useState } from 'react'
import './Export.css'

export interface ExportOptions {
  romanNumerals: boolean
  showChapterTitle: boolean
  includeCover: boolean
  includeFrontMatter: boolean
  pageFrom: number | null
  pageTo: number | null
}

const STORAGE_KEY = 'exportDialogPrefs'

function loadPrefs(): Pick<ExportOptions, 'romanNumerals' | 'showChapterTitle' | 'includeCover' | 'includeFrontMatter'> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { romanNumerals: true, showChapterTitle: false, includeCover: true, includeFrontMatter: true }
}

interface Props {
  onClose: () => void
  onExport: (opts: ExportOptions) => void
}

export function ExportDialog({ onClose, onExport }: Props): JSX.Element {
  const prefs = loadPrefs()
  const [romanNumerals, setRomanNumerals] = useState(prefs.romanNumerals)
  const [showChapterTitle, setShowChapterTitle] = useState(prefs.showChapterTitle)
  const [includeCover, setIncludeCover] = useState(prefs.includeCover)
  const [includeFrontMatter, setIncludeFrontMatter] = useState(prefs.includeFrontMatter)
  const [pageFrom, setPageFrom] = useState('')
  const [pageTo, setPageTo] = useState('')
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleOverlayClick = (e: React.MouseEvent): void => {
    if (e.target === overlayRef.current) onClose()
  }

  const savePrefs = (patch: Partial<typeof prefs>): void => {
    const next = { romanNumerals, showChapterTitle, includeCover, includeFrontMatter, ...patch }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  const handleExport = (): void => {
    const from = pageFrom.trim() ? parseInt(pageFrom, 10) : null
    const to = pageTo.trim() ? parseInt(pageTo, 10) : null
    onExport({ romanNumerals, showChapterTitle, includeCover, includeFrontMatter, pageFrom: from, pageTo: to })
  }

  const pageRangeValid = (): boolean => {
    const from = pageFrom.trim() ? parseInt(pageFrom, 10) : null
    const to = pageTo.trim() ? parseInt(pageTo, 10) : null
    if (from !== null && (isNaN(from) || from < 1)) return false
    if (to !== null && (isNaN(to) || to < 1)) return false
    if (from !== null && to !== null && from > to) return false
    return true
  }

  return (
    <div className="settings-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="settings-dialog export-dialog">
        <div className="settings-header">
          <span className="settings-title">Export manuscript</span>
          <button className="settings-close" onClick={onClose}>✕</button>
        </div>

        <div className="settings-body">
          <div className="export-toggles">
            <label className="export-toggle">
              <input
                type="checkbox"
                checked={romanNumerals}
                onChange={e => { setRomanNumerals(e.target.checked); savePrefs({ romanNumerals: e.target.checked }) }}
              />
              <span className="export-toggle-label">Roman numeral chapter numbers</span>
              <span className="export-toggle-hint">I, II, III… before the chapter heading</span>
            </label>

            <label className="export-toggle">
              <input
                type="checkbox"
                checked={showChapterTitle}
                onChange={e => { setShowChapterTitle(e.target.checked); savePrefs({ showChapterTitle: e.target.checked }) }}
              />
              <span className="export-toggle-label">Show chapter title</span>
              <span className="export-toggle-hint">File name as the chapter heading</span>
            </label>

            <label className="export-toggle">
              <input
                type="checkbox"
                checked={includeCover}
                onChange={e => { setIncludeCover(e.target.checked); savePrefs({ includeCover: e.target.checked }) }}
              />
              <span className="export-toggle-label">Include cover page</span>
              <span className="export-toggle-hint">Author contact block and word count</span>
            </label>

            <label className="export-toggle">
              <input
                type="checkbox"
                checked={includeFrontMatter}
                onChange={e => { setIncludeFrontMatter(e.target.checked); savePrefs({ includeFrontMatter: e.target.checked }) }}
              />
              <span className="export-toggle-label">Include front &amp; back matter</span>
              <span className="export-toggle-hint">Prologue, Content Warning, Epilogue</span>
            </label>
          </div>

          <div className="settings-field">
            <span className="settings-label">Page range</span>
            <div className="export-page-range">
              <input
                className="settings-input export-page-input"
                type="number"
                min={1}
                placeholder="From"
                value={pageFrom}
                onChange={e => setPageFrom(e.target.value)}
              />
              <span className="export-page-dash">–</span>
              <input
                className="settings-input export-page-input"
                type="number"
                min={1}
                placeholder="To"
                value={pageTo}
                onChange={e => setPageTo(e.target.value)}
              />
            </div>
            <p className="settings-hint">Leave blank to export all pages. Page numbers match the manuscript header (cover page not counted).</p>
            {!pageRangeValid() && (
              <p className="settings-hint settings-hint--warn">Invalid page range.</p>
            )}
          </div>
        </div>

        <div className="settings-footer">
          <div />
          <div className="settings-footer-actions">
            <button className="settings-btn settings-btn--secondary" onClick={onClose}>Cancel</button>
            <button
              className="settings-btn settings-btn--primary"
              onClick={handleExport}
              disabled={!pageRangeValid()}
            >
              Export PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
