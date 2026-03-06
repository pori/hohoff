import { useEffect, useRef, useState } from 'react'
import './Settings.css'

interface Props {
  onClose: () => void
}

export function SettingsDialog({ onClose }: Props): JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [originalPath, setOriginalPath] = useState('')
  const [saved, setSaved] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.readConfig().then((cfg) => {
      setApiKey(cfg.apiKey ?? '')
      setProjectPath(cfg.projectPath ?? '')
      setOriginalPath(cfg.projectPath ?? '')
    })
  }, [])

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

  const handleBrowse = async (): Promise<void> => {
    const picked = await window.api.pickProjectFolder()
    if (picked) setProjectPath(picked)
  }

  const handleSave = async (): Promise<void> => {
    await window.api.writeConfig({ apiKey: apiKey || undefined, projectPath: projectPath || undefined })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const pathChanged = projectPath !== originalPath

  return (
    <div className="settings-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="settings-dialog" role="dialog" aria-modal="true" aria-label="Preferences">
        <div className="settings-header">
          <span className="settings-title">Preferences</span>
          <button className="settings-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="settings-body">
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
            <p className="settings-hint">Changes take effect immediately — no restart needed.</p>
          </div>

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
            {pathChanged && (
              <p className="settings-hint settings-hint--warn">Restart the app to load the new project.</p>
            )}
          </div>
        </div>

        <div className="settings-footer">
          <span className="settings-config-path">Config: ~/.hohoff/config.json</span>
          <div className="settings-footer-actions">
            <button className="settings-btn settings-btn--secondary" onClick={onClose}>Cancel</button>
            <button className="settings-btn settings-btn--primary" onClick={handleSave}>
              {saved ? 'Saved ✓' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
