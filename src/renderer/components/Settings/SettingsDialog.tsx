import { useEffect, useRef, useState } from 'react'
import './Settings.css'

interface Props {
  onClose: () => void
  onProjectChanged?: () => void
  isSetup?: boolean
}

export function SettingsDialog({ onClose, onProjectChanged, isSetup }: Props): JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [projectTitle, setProjectTitle] = useState('')
  const [originalPath, setOriginalPath] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [penName, setPenName] = useState('')
  const [authorAddress, setAuthorAddress] = useState('')
  const [authorEmail, setAuthorEmail] = useState('')
  const [authorPhone, setAuthorPhone] = useState('')
  const [saved, setSaved] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.readConfig().then((cfg) => {
      setApiKey(cfg.apiKey ?? '')
      setProjectPath(cfg.projectPath ?? '')
      setProjectTitle(cfg.projectTitle ?? '')
      setOriginalPath(cfg.projectPath ?? '')
      setAuthorName(cfg.authorName ?? '')
      setPenName(cfg.penName ?? '')
      setAuthorAddress(cfg.authorAddress ?? '')
      setAuthorEmail(cfg.authorEmail ?? '')
      setAuthorPhone(cfg.authorPhone ?? '')
    })
  }, [])

  useEffect(() => {
    if (isSetup) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, isSetup])

  const handleOverlayClick = (e: React.MouseEvent): void => {
    if (!isSetup && e.target === overlayRef.current) onClose()
  }

  const handleBrowse = async (): Promise<void> => {
    const picked = await window.api.pickProjectFolder()
    if (picked) setProjectPath(picked)
  }

  const handleSave = async (): Promise<void> => {
    await window.api.writeConfig({
      apiKey: apiKey || undefined,
      projectPath: projectPath || undefined,
      projectTitle: projectTitle.trim() || undefined,
      authorName: authorName.trim() || undefined,
      penName: penName.trim() || undefined,
      authorAddress: authorAddress.trim() || undefined,
      authorEmail: authorEmail.trim() || undefined,
      authorPhone: authorPhone.trim() || undefined,
    })
    if (projectPath !== originalPath) onProjectChanged?.()
    setOriginalPath(projectPath)
    setSaved(true)
    setTimeout(() => { setSaved(false); onClose() }, 800)
  }

  return (
    <div className="settings-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="settings-dialog" role="dialog" aria-modal="true" aria-label={isSetup ? 'Welcome' : 'Preferences'}>
        <div className="settings-header">
          <span className="settings-title">{isSetup ? 'Welcome to Hohoff' : 'Preferences'}</span>
          {!isSetup && (
            <button className="settings-close" onClick={onClose} aria-label="Close">✕</button>
          )}
        </div>

        {isSetup && (
          <p className="settings-setup-subtitle">Configure your project folder and API key to get started.</p>
        )}

        <div className="settings-body">
          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-project-path">Project Folder</label>
            <div className="settings-path-row">
              <input
                id="settings-project-path"
                className="settings-input settings-input--path"
                type="text"
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                placeholder="/path/to/draft"
                spellCheck={false}
              />
              <button className="settings-browse-btn" onClick={handleBrowse}>Browse…</button>
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-project-title">Project Title</label>
            <input
              id="settings-project-title"
              className="settings-input"
              type="text"
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              placeholder="My Novel"
              spellCheck={false}
            />
            <p className="settings-hint">Used as the title in PDF exports. Defaults to the project folder name if left blank.</p>
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-api-key">Anthropic API Key</label>
            <input
              id="settings-api-key"
              className="settings-input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-…"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="settings-hint">Used for AI features. Changes take effect immediately.</p>
          </div>

          <div className="settings-section-divider"><span>Manuscript</span></div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-author-name">Author Name</label>
            <input
              id="settings-author-name"
              className="settings-input"
              type="text"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="Jane Smith"
              spellCheck={false}
            />
            <p className="settings-hint">Legal name used on manuscript cover pages and PDF headers.</p>
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-pen-name">Pen Name / Byline</label>
            <input
              id="settings-pen-name"
              className="settings-input"
              type="text"
              value={penName}
              onChange={(e) => setPenName(e.target.value)}
              placeholder="J. Smith"
              spellCheck={false}
            />
            <p className="settings-hint">Name shown as author (e.g. "by…"). Defaults to Author Name if blank.</p>
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-author-address">Address</label>
            <textarea
              id="settings-author-address"
              className="settings-textarea"
              value={authorAddress}
              onChange={(e) => setAuthorAddress(e.target.value)}
              placeholder={"123 Example Street\nCity, Country"}
              rows={3}
              spellCheck={false}
            />
          </div>

          <div className="settings-two-col">
            <div className="settings-field">
              <label className="settings-label" htmlFor="settings-author-email">Email</label>
              <input
                id="settings-author-email"
                className="settings-input"
                type="email"
                value={authorEmail}
                onChange={(e) => setAuthorEmail(e.target.value)}
                placeholder="jane@example.com"
                spellCheck={false}
              />
            </div>
            <div className="settings-field">
              <label className="settings-label" htmlFor="settings-author-phone">Phone</label>
              <input
                id="settings-author-phone"
                className="settings-input"
                type="tel"
                value={authorPhone}
                onChange={(e) => setAuthorPhone(e.target.value)}
                placeholder="+1 555 000 0000"
                spellCheck={false}
              />
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <span className="settings-config-path">Config: ~/.hohoff/config.json</span>
          <div className="settings-footer-actions">
            {!isSetup && (
              <button className="settings-btn settings-btn--secondary" onClick={onClose}>Cancel</button>
            )}
            <button className="settings-btn settings-btn--primary" onClick={handleSave}>
              {saved ? 'Saved ✓' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
