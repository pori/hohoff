import { useRef, useEffect, useState } from 'react'
import { useEditorStore } from '../../store/editorStore'
import { ChatMessageItem } from './ChatMessageItem'
import { ChatInput } from './ChatInput'
import { FeedbackPanel } from '../Feedback/FeedbackPanel'
import { parseAnnotationsFromAIResponse } from '../../utils/annotationParser'
import type { Attachment, TextAnnotation } from '../../types/editor'
import './Chat.css'

type TabId = 'chat' | 'feedback'

function formatSessionTime(createdAt: number): string {
  const date = new Date(createdAt)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = date.toDateString() === yesterday.toDateString()
  if (isToday) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (isYesterday) return 'Yesterday'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function ChatPanel(): JSX.Element {
  const {
    chatHistory,
    chatSessionsByFile,
    activeSessionIdByFile,
    isAILoading,
    aiError,
    activeFileContent,
    activeFilePath,
    analysisMode,
    annotations,
    annotationsByFile,
    addUserMessage,
    startAssistantMessage,
    appendToLastAssistantMessage,
    setAILoading,
    setAIError,
    setAnnotations,
    linkAnnotationsToMessage,
    newChat,
    setActiveSession
  } = useEditorStore()

  const [tab, setTab] = useState<TabId>('chat')
  const [showHistory, setShowHistory] = useState(false)
  const [pendingAttachmentCount, setPendingAttachmentCount] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevAnnotationCountRef = useRef(annotations.length)

  // Collapse history when switching files
  useEffect(() => { setShowHistory(false) }, [activeFilePath])

  // Auto-switch to Feedback tab the first time annotations appear (0 → >0)
  useEffect(() => {
    const prev = prevAnnotationCountRef.current
    const curr = annotations.length
    if (prev === 0 && curr > 0) {
      setTab('feedback')
    }
    prevAnnotationCountRef.current = curr
  }, [annotations])

  const sendMessage = async (text: string, attachments: Attachment[]): Promise<void> => {
    if (!activeFilePath || isAILoading) return

    setAIError(null)
    addUserMessage(text, attachments.map(({ name, mimeType }) => ({ name, mimeType })))
    startAssistantMessage()
    setAILoading(true)

    try {
      const mode = analysisMode === 'none' ? 'chat' : analysisMode
      await window.api.streamAIMessage(
        {
          mode,
          documentContent: activeFileContent,
          documentPath: activeFilePath,
          conversationHistory: chatHistory
            .slice(-10)
            .map((m) => ({ role: m.role, content: m.content })),
          userMessage: text,
          attachments: attachments.length > 0 ? attachments : undefined
        },
        (chunk: string) => {
          appendToLastAssistantMessage(chunk)
        }
      )

      // After streaming, parse AI response for annotations.
      // Attachment-driven messages are tagged 'custom' so they appear with a
      // distinct visual treatment in the Feedback panel.
      const currentHistory = useEditorStore.getState().chatHistory
      const lastMsg = currentHistory[currentHistory.length - 1]
      if (lastMsg?.role === 'assistant' && lastMsg.content.length > 0) {
        const overrideType = attachments.length > 0 ? 'custom' as const : undefined
        const parsed = parseAnnotationsFromAIResponse(lastMsg.content, activeFileContent, overrideType)
        if (parsed.length > 0) {
          setAnnotations(parsed)
          linkAnnotationsToMessage(lastMsg.id, parsed.map(a => a.id))
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setAIError(message)
    } finally {
      setAILoading(false)
    }
  }

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [chatHistory])

  const hasFile = Boolean(activeFilePath)
  const allAnnotationsForFile: TextAnnotation[] =
    (activeFilePath ? annotationsByFile[activeFilePath]?.annotations : undefined) ?? []

  const sessions = (activeFilePath ? chatSessionsByFile[activeFilePath] : undefined) ?? []
  const activeSessionId = activeFilePath ? activeSessionIdByFile[activeFilePath] : undefined

  // Subheader is shown in the chat tab once there is at least one session
  const showSubheader = tab === 'chat' && sessions.length > 0

  return (
    <div className="chat-panel">
      {/* ── Tab bar ── */}
      <div className="chat-tabs">
        <button
          className={`chat-tab${tab === 'chat' ? ' chat-tab-active' : ''}`}
          onClick={() => setTab('chat')}
        >
          Chat
        </button>
        <button
          className={`chat-tab${tab === 'feedback' ? ' chat-tab-active' : ''}`}
          onClick={() => setTab('feedback')}
        >
          Feedback
          {annotations.length > 0 && (
            <span className="chat-tab-badge">{annotations.length}</span>
          )}
        </button>
      </div>

      {/* ── Chat sub-header: History link + New Chat button ── */}
      {showSubheader && (
        <div className="chat-subheader">
          <button
            className={`chat-history-link${showHistory ? ' chat-history-link-active' : ''}`}
            onClick={() => setShowHistory(v => !v)}
          >
            {showHistory ? 'Back to chat' : `History${sessions.length > 1 ? ` (${sessions.length})` : ''}`}
          </button>
          {!showHistory && chatHistory.length > 0 && (
            <button className="chat-new-btn" onClick={newChat} title="Start a new conversation">
              + New Chat
            </button>
          )}
        </div>
      )}

      {/* ── Pending-attachment indicator ── */}
      {pendingAttachmentCount > 0 && (
        <div className="chat-attachment-indicator">
          <span className="chat-attachment-indicator-icon">⌁</span>
          {pendingAttachmentCount} file{pendingAttachmentCount !== 1 ? 's' : ''} attached to next message
        </div>
      )}

      {/* ── Panel content ── */}
      {tab === 'feedback' ? (
        <FeedbackPanel />
      ) : showHistory ? (
        <div className="chat-history-list">
          {[...sessions].reverse().map((session) => {
            const isActive = session.id === activeSessionId
            const firstUserMsg = session.messages.find(m => m.role === 'user')
            const summary = firstUserMsg
              ? firstUserMsg.content.slice(0, 80) + (firstUserMsg.content.length > 80 ? '…' : '')
              : 'Empty conversation'
            return (
              <button
                key={session.id}
                className={`chat-history-item${isActive ? ' chat-history-item-active' : ''}`}
                onClick={() => {
                  setActiveSession(session.id)
                  setShowHistory(false)
                }}
              >
                <span className="chat-history-time">{formatSessionTime(session.createdAt)}</span>
                <span className="chat-history-summary">{summary}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <>
          <div className="chat-messages" ref={scrollRef}>
            {!hasFile && (
              <p className="chat-placeholder">Open a chapter to start a conversation about it.</p>
            )}
            {hasFile && chatHistory.length === 0 && (
              <p className="chat-placeholder">
                Ask anything about the current chapter — passive voice, plot, character, style...
              </p>
            )}
            {chatHistory.map((msg) => {
              const linkedAnnotations = (msg.annotationIds ?? [])
                .map(id => allAnnotationsForFile.find(a => a.id === id))
                .filter((a): a is TextAnnotation => a !== undefined)
              return (
                <ChatMessageItem
                  key={msg.id}
                  message={msg}
                  linkedAnnotations={linkedAnnotations}
                />
              )
            })}
            {isAILoading && chatHistory[chatHistory.length - 1]?.content === '' && (
              <div className="chat-typing">
                <span />
                <span />
                <span />
              </div>
            )}
            {aiError && (
              <div className="chat-error">{aiError}</div>
            )}
          </div>

          <ChatInput
            onSend={sendMessage}
            onAttachmentsChange={setPendingAttachmentCount}
            disabled={!hasFile || isAILoading}
          />
        </>
      )}
    </div>
  )
}
