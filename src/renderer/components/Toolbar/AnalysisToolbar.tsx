import { useEffect } from 'react'
import { useEditorStore } from '../../store/editorStore'
import { detectPassiveVoice } from '../../utils/passiveVoice'
import { parseAnnotationsFromAIResponse } from '../../utils/annotationParser'
import './Toolbar.css'

function countWords(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length
}

function formatWordCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function AnalysisToolbar(): JSX.Element {
  const {
    activeFilePath,
    activeFileContent,
    isDirty,
    analysisMode,
    annotations,
    isAILoading,
    setAnnotations,
    clearAnnotations,
    setAnalysisMode,
    addUserMessage,
    startAssistantMessage,
    appendToLastAssistantMessage,
    setAILoading,
    setAIError,
    chatHistory,
    projectWordCount,
    setProjectWordCount,
    fontSize,
    setFontSize
  } = useEditorStore()

  useEffect(() => {
    window.api.getProjectWordCount().then(setProjectWordCount).catch(() => {})
  }, [])

  // Refresh project count after a save (isDirty transitions from true → false)
  useEffect(() => {
    if (!isDirty) {
      window.api.getProjectWordCount().then(setProjectWordCount).catch(() => {})
    }
  }, [isDirty])

  const hasFile = Boolean(activeFilePath)

  const runPassiveVoice = (): void => {
    if (!hasFile) return
    const found = detectPassiveVoice(activeFileContent)
    setAnnotations(found)
    setAnalysisMode('passive_voice')
  }

  const runAIAnalysis = async (mode: 'consistency' | 'style'): Promise<void> => {
    if (!activeFilePath || isAILoading) return

    setAnalysisMode(mode)
    setAIError(null)

    const prompt =
      mode === 'consistency'
        ? 'Please check this chapter for consistency issues (character names, timeline, repeated phrases).'
        : 'Please analyze the style and pacing of this chapter and suggest improvements.'

    addUserMessage(prompt)
    startAssistantMessage()
    setAILoading(true)

    try {
      await window.api.streamAIMessage(
        {
          mode,
          documentContent: activeFileContent,
          documentPath: activeFilePath,
          conversationHistory: chatHistory
            .slice(-10)
            .map((m) => ({ role: m.role, content: m.content })),
          userMessage: prompt
        },
        (chunk: string) => {
          appendToLastAssistantMessage(chunk)
        }
      )

      // Parse annotations from response
      const currentHistory = useEditorStore.getState().chatHistory
      const lastMsg = currentHistory[currentHistory.length - 1]
      if (lastMsg?.role === 'assistant' && lastMsg.content.length > 0) {
        const newAnnotations = parseAnnotationsFromAIResponse(lastMsg.content, activeFileContent)
        if (newAnnotations.length > 0) setAnnotations(newAnnotations)
      }
    } catch (err) {
      setAIError(err instanceof Error ? err.message : 'Analysis failed')
    } finally {
      setAILoading(false)
    }
  }

  const passiveCount = annotations.filter((a) => a.type === 'passive_voice').length
  const otherCount = annotations.filter((a) => a.type !== 'passive_voice').length
  const docWordCount = countWords(activeFileContent)

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <button
          className={`toolbar-btn${analysisMode === 'passive_voice' ? ' active' : ''}`}
          onClick={runPassiveVoice}
          disabled={!hasFile}
          title="Highlight passive voice sentences instantly (no AI required)"
        >
          Passive Voice
          {analysisMode === 'passive_voice' && passiveCount > 0 && (
            <span className="toolbar-badge">{passiveCount}</span>
          )}
        </button>

        <button
          className={`toolbar-btn${analysisMode === 'consistency' ? ' active' : ''}`}
          onClick={() => runAIAnalysis('consistency')}
          disabled={!hasFile || isAILoading}
          title="Check character names, timeline, and repeated phrases via AI"
        >
          {isAILoading && analysisMode === 'consistency' ? 'Checking…' : 'Consistency'}
          {analysisMode === 'consistency' && otherCount > 0 && (
            <span className="toolbar-badge">{otherCount}</span>
          )}
        </button>

        <button
          className={`toolbar-btn${analysisMode === 'style' ? ' active' : ''}`}
          onClick={() => runAIAnalysis('style')}
          disabled={!hasFile || isAILoading}
          title="Pacing, sentence variety, show-don't-tell feedback via AI"
        >
          {isAILoading && analysisMode === 'style' ? 'Analyzing…' : 'Style'}
          {analysisMode === 'style' && otherCount > 0 && (
            <span className="toolbar-badge">{otherCount}</span>
          )}
        </button>

        {annotations.length > 0 && (
          <button
            className="toolbar-btn toolbar-btn-clear"
            onClick={clearAnnotations}
            title="Remove all highlights"
          >
            Clear
          </button>
        )}
      </div>

      <div className="toolbar-right">
        <div className="toolbar-fontsize">
          <button
            className="toolbar-fontsize-btn"
            onClick={() => setFontSize(fontSize - 1)}
            disabled={fontSize <= 11}
            title="Decrease font size"
          >
            A−
          </button>
          <button
            className="toolbar-fontsize-btn"
            onClick={() => setFontSize(fontSize + 1)}
            disabled={fontSize >= 24}
            title="Increase font size"
          >
            A+
          </button>
        </div>
        {activeFilePath && (
          <span
            className="toolbar-wordcount"
            title={`This document: ${docWordCount.toLocaleString()} words · Entire project: ${projectWordCount.toLocaleString()} words`}
          >
            {formatWordCount(docWordCount)}
            <span className="toolbar-wordcount-sep">/</span>
            {formatWordCount(projectWordCount)}
          </span>
        )}
        {isDirty && (
          <span className="toolbar-dirty" title="Unsaved changes — press Cmd+S to save">
            ●
          </span>
        )}
        {activeFilePath && (
          <span className="toolbar-filename">
            {activeFilePath.split('/').pop()?.replace(/\.md$/, '')}
          </span>
        )}
      </div>
    </div>
  )
}
