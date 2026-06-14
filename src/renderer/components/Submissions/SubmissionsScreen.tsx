import { useEffect, useState, useCallback } from 'react'
import type { Submission, SubmissionStatus, SubmissionType } from '../../types/editor'
import './SubmissionsScreen.css'

const STATUS_LABELS: Record<SubmissionStatus, string> = {
  drafting: 'Drafting',
  submitted: 'Submitted',
  awaiting: 'Awaiting',
  shortlisted: 'Shortlisted',
  rejected: 'Rejected',
  accepted: 'Accepted',
  withdrawn: 'Withdrawn',
}

const TYPE_LABELS: Record<SubmissionType, string> = {
  agent: 'Agent',
  publisher: 'Publisher',
  competition: 'Competition',
  other: 'Other',
}

function newSubmission(): Submission {
  return {
    id: crypto.randomUUID(),
    recipient: '',
    type: 'publisher',
    dateSubmitted: null,
    deadline: null,
    status: 'drafting',
    queryLetter: '',
    notes: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function daysUntil(isoDate: string): number {
  const deadline = new Date(isoDate + 'T00:00:00').getTime()
  const now = new Date().setHours(0, 0, 0, 0)
  return Math.ceil((deadline - now) / 86400000)
}

function DeadlineBadge({ date }: { date: string }): JSX.Element {
  const days = daysUntil(date)
  const label = days === 0 ? 'today' : days === 1 ? '1 day' : days < 0 ? `${Math.abs(days)}d ago` : `${days}d`
  const cls = days < 0 ? 'deadline-past' : days <= 7 ? 'deadline-soon' : 'deadline-ok'
  return <span className={`deadline-badge ${cls}`}>{label}</span>
}

export function SubmissionsScreen(): JSX.Element {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Submission | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    window.api.readSubmissions().then(data => {
      setSubmissions(data)
      if (data.length > 0) {
        setSelectedId(data[0].id)
        setDraft(data[0])
      }
    }).catch(console.error)
  }, [])

  const save = useCallback(async (updated: Submission[]) => {
    setSubmissions(updated)
    await window.api.writeSubmissions(updated)
  }, [])

  function selectSubmission(sub: Submission): void {
    if (dirty && draft) {
      const updated = submissions.map(s => s.id === draft.id ? draft : s)
      save(updated).catch(console.error)
      setDirty(false)
    }
    setSelectedId(sub.id)
    setDraft({ ...sub })
  }

  function addNew(): void {
    if (dirty && draft) {
      const updated = submissions.map(s => s.id === draft.id ? draft : s)
      save(updated).catch(console.error)
      setDirty(false)
    }
    const sub = newSubmission()
    const updated = [sub, ...submissions]
    setSubmissions(updated)
    setSelectedId(sub.id)
    setDraft(sub)
    window.api.writeSubmissions(updated).catch(console.error)
  }

  function deleteSelected(): void {
    if (!selectedId) return
    const updated = submissions.filter(s => s.id !== selectedId)
    save(updated).catch(console.error)
    setDirty(false)
    if (updated.length > 0) {
      setSelectedId(updated[0].id)
      setDraft({ ...updated[0] })
    } else {
      setSelectedId(null)
      setDraft(null)
    }
  }

  function updateDraft<K extends keyof Submission>(key: K, value: Submission[K]): void {
    if (!draft) return
    setDraft(prev => prev ? { ...prev, [key]: value, updatedAt: Date.now() } : prev)
    setDirty(true)
  }

  function saveDraft(): void {
    if (!draft) return
    const updated = submissions.map(s => s.id === draft.id ? draft : s)
    save(updated).catch(console.error)
    setDirty(false)
  }

  const sorted = [...submissions].sort((a, b) => {
    // Sort: active statuses first, then by deadline, then by updatedAt
    const activeStatuses: SubmissionStatus[] = ['drafting', 'submitted', 'awaiting', 'shortlisted']
    const aActive = activeStatuses.includes(a.status)
    const bActive = activeStatuses.includes(b.status)
    if (aActive !== bActive) return aActive ? -1 : 1
    if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline)
    if (a.deadline) return -1
    if (b.deadline) return 1
    return b.updatedAt - a.updatedAt
  })

  return (
    <div className="subs-screen">
      <div className="subs-list">
        <div className="subs-list-header">
          <span className="subs-list-title">Submissions</span>
          <button className="subs-add-btn" onClick={addNew} title="New submission">+</button>
        </div>
        <div className="subs-list-items">
          {sorted.length === 0 && (
            <div className="subs-empty">No submissions yet</div>
          )}
          {sorted.map(sub => (
            <button
              key={sub.id}
              className={`subs-list-item${selectedId === sub.id ? ' selected' : ''}`}
              onClick={() => selectSubmission(sub)}
            >
              <div className="subs-item-top">
                <span className="subs-item-recipient">{sub.recipient || 'Untitled'}</span>
                <span className={`subs-status-dot status-${sub.status}`} title={STATUS_LABELS[sub.status]} />
              </div>
              <div className="subs-item-meta">
                <span className="subs-item-type">{TYPE_LABELS[sub.type]}</span>
                {sub.deadline && <DeadlineBadge date={sub.deadline} />}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="subs-detail">
        {!draft ? (
          <div className="subs-no-selection">
            <button className="subs-new-btn" onClick={addNew}>New submission</button>
          </div>
        ) : (
          <>
            <div className="subs-detail-header">
              <div className="subs-detail-fields">
                <div className="subs-field-row">
                  <input
                    className="subs-recipient-input"
                    placeholder="Recipient name"
                    value={draft.recipient}
                    onChange={e => updateDraft('recipient', e.target.value)}
                    onBlur={saveDraft}
                  />
                  <select
                    className="subs-select"
                    value={draft.type}
                    onChange={e => { updateDraft('type', e.target.value as SubmissionType); saveDraft() }}
                  >
                    {(Object.keys(TYPE_LABELS) as SubmissionType[]).map(t => (
                      <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                  <select
                    className="subs-select"
                    value={draft.status}
                    onChange={e => { updateDraft('status', e.target.value as SubmissionStatus); saveDraft() }}
                  >
                    {(Object.keys(STATUS_LABELS) as SubmissionStatus[]).map(s => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
                <div className="subs-field-row subs-dates-row">
                  <label className="subs-date-label">
                    <span>Submitted</span>
                    <input
                      type="date"
                      className="subs-date-input"
                      value={draft.dateSubmitted ?? ''}
                      onChange={e => updateDraft('dateSubmitted', e.target.value || null)}
                      onBlur={saveDraft}
                    />
                  </label>
                  <label className="subs-date-label">
                    <span>Deadline</span>
                    <input
                      type="date"
                      className="subs-date-input"
                      value={draft.deadline ?? ''}
                      onChange={e => updateDraft('deadline', e.target.value || null)}
                      onBlur={saveDraft}
                    />
                  </label>
                  <button className="subs-delete-btn" onClick={deleteSelected} title="Delete submission">Delete</button>
                </div>
              </div>
            </div>

            <div className="subs-detail-body">
              <div className="subs-section">
                <div className="subs-section-label">Query letter</div>
                <textarea
                  className="subs-query-letter"
                  placeholder="Write your query letter for this submission…"
                  value={draft.queryLetter}
                  onChange={e => updateDraft('queryLetter', e.target.value)}
                  onBlur={saveDraft}
                />
              </div>
              <div className="subs-section subs-notes-section">
                <div className="subs-section-label">Notes</div>
                <textarea
                  className="subs-notes"
                  placeholder="Contacts, requirements, response…"
                  value={draft.notes}
                  onChange={e => updateDraft('notes', e.target.value)}
                  onBlur={saveDraft}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
