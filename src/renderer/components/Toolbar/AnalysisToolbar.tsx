import { useEffect } from 'react'
import { useEditorStore } from '../../store/editorStore'
import { detectPassiveVoice } from '../../utils/passiveVoice'
import { parseAnnotationsFromAIResponse } from '../../utils/annotationParser'
import { tooltipAnalysisCache } from '../Editor/MarkdownEditor'
import './Toolbar.css'

const BIBLE_PROMPTS = {
  full: `Read the full manuscript and generate comprehensive story bible content as markdown. Include:

## Characters
[Detailed profile for every named character: role, physical description, personality, key relationships, arc]

## World & Setting
[Geography, historical period, Basque Country cultural details, atmosphere, key locations]

## Timeline
[Key events in chronological order with chapter references]

## Themes & Motifs
[Recurring symbols, imagery, thematic concerns]

## Continuity Rules
[Facts that must stay consistent: character details, established plot points, internal logic]

Base everything strictly on what is in the manuscript text.`,

  characters: `Read the full manuscript and write character profiles for the Story Bible. Begin your response with the heading \`## Characters\` followed by a blank line. For each named character include: role, physical description, personality traits, key relationships, and arc. Format each character as a ### subsection.`,

  timeline: `Read the full manuscript and extract all significant events in chronological order for the Story Bible. Begin your response with the heading \`## Timeline\` followed by a blank line. Reference chapters where helpful. Format as a numbered list.`,

  world: `Read the full manuscript and write a World & Setting section for the Story Bible. Begin your response with the heading \`## World & Setting\` followed by a blank line. Cover: the Basque Country geography and atmosphere, the historical period and cultural context, and key locations described in the text.`
}

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
    linkAnnotationsToMessage,
    chatHistory,
    projectWordCount,
    setProjectWordCount,
    fontSize,
    setFontSize,
    setRightPanelTab,
    outlineOpen,
    toggleOutline
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
  const isStoryBible = activeFilePath?.endsWith('Story Bible.md') ?? false

  const runBibleGeneration = async (prompt: string): Promise<void> => {
    if (!activeFilePath || isAILoading) return
    setAIError(null)
    setRightPanelTab('chat')

    addUserMessage(prompt)
    startAssistantMessage({ bibleGeneration: true })
    setAILoading(true)

    try {
      await window.api.streamAIMessage(
        {
          mode: 'chat',
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
    } catch (err) {
      setAIError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setAILoading(false)
    }
  }

  const runPassiveVoice = (): void => {
    if (!hasFile) return
    const found = detectPassiveVoice(activeFileContent)
    const existing = useEditorStore.getState().annotations.filter((a) => a.type !== 'passive_voice')
    setAnnotations([...existing, ...found])
    setAnalysisMode('passive_voice')
  }

  const runAIAnalysis = async (mode: 'consistency' | 'style' | 'show_tell' | 'critique'): Promise<void> => {
    if (!activeFilePath || isAILoading) return

    setAnalysisMode(mode)
    setAIError(null)

    const prompt =
      mode === 'consistency'
        ? 'Please check this chapter for consistency issues (character names, timeline, repeated phrases).'
        : mode === 'style'
          ? 'Please analyze the style and pacing of this chapter and suggest improvements.'
          : mode === 'show_tell'
            ? 'Please identify every passage in this chapter where I am telling rather than showing.'
            : 'Please give me an honest critique of this chapter.'

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
        // For show_tell mode, force all annotations to the show_tell type so the
        // classifier doesn't accidentally mis-label them as 'style' or 'consistency'.
        const overrideType = mode === 'show_tell' ? 'show_tell' : undefined
        const { annotations: newAnnotations } = parseAnnotationsFromAIResponse(lastMsg.content, activeFileContent, overrideType)
        if (newAnnotations.length > 0) {
          const existing = useEditorStore.getState().annotations.filter((a) => a.type !== mode)
          setAnnotations([...existing, ...newAnnotations])
          linkAnnotationsToMessage(lastMsg.id, newAnnotations.map(a => a.id))
        }
      }
    } catch (err) {
      setAIError(err instanceof Error ? err.message : 'Analysis failed')
    } finally {
      setAILoading(false)
    }
  }

  const passiveCount = annotations.filter((a) => a.type === 'passive_voice').length
  const consistencyCount = annotations.filter((a) => a.type === 'consistency').length
  const styleCount = annotations.filter((a) => a.type === 'style').length
  const showTellCount = annotations.filter((a) => a.type === 'show_tell').length
  const critiqueCount = annotations.filter((a) => a.type === 'critique').length
  const docWordCount = countWords(activeFileContent)

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        {isStoryBible ? (
          <>
            <span className="toolbar-bible-label">Generate from manuscript:</span>
            <button
              className="toolbar-btn toolbar-btn-bible"
              onClick={() => runBibleGeneration(BIBLE_PROMPTS.full)}
              disabled={isAILoading}
              title="Generate all story bible sections from the full manuscript"
            >
              {isAILoading ? 'Generating…' : 'Full bible'}
            </button>
            <button
              className="toolbar-btn toolbar-btn-bible"
              onClick={() => runBibleGeneration(BIBLE_PROMPTS.characters)}
              disabled={isAILoading}
              title="Extract character profiles from the manuscript"
            >
              Characters
            </button>
            <button
              className="toolbar-btn toolbar-btn-bible"
              onClick={() => runBibleGeneration(BIBLE_PROMPTS.timeline)}
              disabled={isAILoading}
              title="Extract timeline of events from the manuscript"
            >
              Timeline
            </button>
            <button
              className="toolbar-btn toolbar-btn-bible"
              onClick={() => runBibleGeneration(BIBLE_PROMPTS.world)}
              disabled={isAILoading}
              title="Extract world & setting details from the manuscript"
            >
              World
            </button>
          </>
        ) : (
          <>
            <button
              className={`toolbar-btn${analysisMode === 'passive_voice' ? ' active' : ''}`}
              onClick={runPassiveVoice}
              disabled={!hasFile}
              title="Highlight passive voice sentences instantly (no AI required)"
            >
              Passive Voice
              {passiveCount > 0 && (
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
              {consistencyCount > 0 && (
                <span className="toolbar-badge">{consistencyCount}</span>
              )}
            </button>

            <button
              className={`toolbar-btn${analysisMode === 'style' ? ' active' : ''}`}
              onClick={() => runAIAnalysis('style')}
              disabled={!hasFile || isAILoading}
              title="Pacing, sentence variety, show-don't-tell feedback via AI"
            >
              {isAILoading && analysisMode === 'style' ? 'Analyzing…' : 'Style'}
              {styleCount > 0 && (
                <span className="toolbar-badge">{styleCount}</span>
              )}
            </button>

            <button
              className={`toolbar-btn${analysisMode === 'show_tell' ? ' active' : ''}`}
              onClick={() => runAIAnalysis('show_tell')}
              disabled={!hasFile || isAILoading}
              title="Find passages that tell rather than show via AI"
            >
              {isAILoading && analysisMode === 'show_tell' ? 'Reading…' : 'Show vs Tell'}
              {showTellCount > 0 && (
                <span className="toolbar-badge">{showTellCount}</span>
              )}
            </button>

            <button
              className={`toolbar-btn${analysisMode === 'critique' ? ' active' : ''}`}
              onClick={() => runAIAnalysis('critique')}
              disabled={!hasFile || isAILoading}
              title="Honest overall critique of this chapter via AI"
            >
              {isAILoading && analysisMode === 'critique' ? 'Reading…' : 'Critique'}
              {critiqueCount > 0 && (
                <span className="toolbar-badge">{critiqueCount}</span>
              )}
            </button>

            {annotations.length > 0 && (
              <button
                className="toolbar-btn toolbar-btn-clear"
                onClick={() => { clearAnnotations(); tooltipAnalysisCache.clear() }}
                title="Remove all highlights"
              >
                Clear
              </button>
            )}
          </>
        )}
      </div>

      <div className="toolbar-right">
        <button
          className={`toolbar-btn toolbar-btn-outline${outlineOpen ? ' active' : ''}`}
          onClick={toggleOutline}
          title={outlineOpen ? 'Hide document outline' : 'Show document outline'}
        >
          ≡
        </button>
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
          <span className="toolbar-filename" title={activeFilePath.split('/').pop()?.replace(/\.md$/, '')}>
            {(() => {
              const name = activeFilePath.split('/').pop()?.replace(/\.md$/, '') ?? ''
              return name.length > 30 ? name.slice(0, 30) + '…' : name
            })()}
          </span>
        )}
      </div>
    </div>
  )
}
