import { useEffect, useRef, useState } from 'react'
import './Export.css'

export interface ExportOptions {
  romanNumerals: boolean
  includeCover: boolean
  includeFrontMatter: boolean
  pageFrom: number | null
  pageTo: number | null
}

interface Props {
  onClose: () => void
  onExport: (opts: ExportOptions) => void
}

export function ExportDialog({ onClose, onExport }: Props): JSX.Element {
  const [romanNumerals, setRomanNumerals] = useState(true)
  const [includeCover, setIncludeCover] = useState(true)
  const [includeFrontMatter, setIncludeFrontMatter] = useState(true)
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

  const handleExport = (): void => {
    const from = pageFrom.trim() ? parseInt(pageFrom, 10) : null
    const to = pageTo.trim() ? parseInt(pageTo, 10) : null
    onExport({ romanNumerals, includeCover, includeFrontMatter, pageFrom: from, pageTo: to })
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
                onChange={e => setRomanNumerals(e.target.checked)}
              />
              <span className="export-toggle-label">Roman numeral chapter titles</span>
              <span className="export-toggle-hint">I, II, III… instead of file names</span>
            </label>

            <label className="export-toggle">
              <input
                type="checkbox"
                checked={includeCover}
                onChange={e => setIncludeCover(e.target.checked)}
              />
              <span className="export-toggle-label">Include cover page</span>
              <span className="export-toggle-hint">Author contact block and word count</span>
            </label>

            <label className="export-toggle">
              <input
                type="checkbox"
                checked={includeFrontMatter}
                onChange={e => setIncludeFrontMatter(e.target.checked)}
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
