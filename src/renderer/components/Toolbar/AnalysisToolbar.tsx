import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEditorStore } from '../../store/editorStore'
import { detectPassiveVoice } from '../../utils/passiveVoice'
import { detectPastProgressive } from '../../utils/pastProgressive'
import { parseAnnotationsFromAIResponse } from '../../utils/annotationParser'
import { tooltipAnalysisCache } from '../Editor/MarkdownEditor'
import '../FileTree/ContextMenu.css'
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

interface ParagraphInfo {
  text: string
  sentences: number
  words: number
}

function computeParagraphRhythm(text: string): ParagraphInfo[] {
  const blocks = text.split(/\n+/)
  const result: ParagraphInfo[] = []
  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed || !/\w/.test(trimmed)) continue
    if (/^#{1,6}\s/.test(trimmed) || /^-{3,}$/.test(trimmed) || /^={3,}$/.test(trimmed)) continue
    const words = countWords(trimmed)
    if (words < 3) continue
    const sentences = trimmed
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && /\w/.test(s)).length
    result.push({ text: trimmed, sentences, words })
  }
  return result
}

function sentenceCountColor(n: number): string {
  if (n === 1) return '#5b8dd9'
  if (n === 2) return '#6db8a0'
  if (n === 3) return '#7dc76e'
  if (n === 4) return '#b5c45a'
  if (n === 5) return '#d4a83a'
  if (n === 6) return '#d47830'
  if (n === 7) return '#c45040'
  return '#b03030'
}

interface SentenceStats {
  avg: number
  stdDev: number
  totalSentences: number
  /** bins[i] = count of sentences with (i+1) words; bins[30] = sentences with 31+ words */
  bins: number[]
  outliers: Array<{ text: string; wordCount: number }>
}

function computeSentenceStats(text: string): SentenceStats | null {
  const sentences = text
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && /\w/.test(s))
  if (sentences.length === 0) return null
  const lengths = sentences.map(s => countWords(s))
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length
  const variance = lengths.reduce((a, b) => a + (b - avg) ** 2, 0) / lengths.length
  const stdDev = Math.sqrt(variance)
  const bins = new Array(31).fill(0)
  const outliers: Array<{ text: string; wordCount: number }> = []
  for (let i = 0; i < sentences.length; i++) {
    const wc = lengths[i]
    bins[Math.min(wc - 1, 30)]++
    if (wc <= 4 || wc >= 26) outliers.push({ text: sentences[i], wordCount: wc })
  }
  return { avg, stdDev, totalSentences: sentences.length, bins, outliers }
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
    finalizeAssistantMessage,
    setStreamingContent,
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
    toggleOutline,
    revisionPanelOpen,
    toggleRevisionPanel,
    selectionWordCount
  } = useEditorStore()

  const streamingContentRef = useRef('')
  const streamingRafRef = useRef<number | null>(null)

  const [analyzeOpen, setAnalyzeOpen] = useState(false)
  const analyzeButtonRef = useRef<HTMLButtonElement>(null)
  const analyzeMenuRef = useRef<HTMLDivElement>(null)

  const [statsOpen, setStatsOpen] = useState(false)
  const statsButtonRef = useRef<HTMLButtonElement>(null)
  const statsMenuRef = useRef<HTMLDivElement>(null)

  const [rhythmOpen, setRhythmOpen] = useState(false)
  const rhythmButtonRef = useRef<HTMLButtonElement>(null)
  const rhythmMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.getProjectWordCount().then(setProjectWordCount).catch(() => {})
  }, [])

  // Refresh project count after a save (isDirty transitions from true → false)
  useEffect(() => {
    if (!isDirty) {
      window.api.getProjectWordCount().then(setProjectWordCount).catch(() => {})
    }
  }, [isDirty])

  // Close dropdowns on file change
  useEffect(() => { setAnalyzeOpen(false); setStatsOpen(false); setRhythmOpen(false) }, [activeFilePath])

  // Click-outside closes dropdown
  useEffect(() => {
    if (!analyzeOpen) return
    const handler = (e: MouseEvent): void => {
      if (
        !analyzeButtonRef.current?.contains(e.target as Node) &&
        !analyzeMenuRef.current?.contains(e.target as Node)
      ) {
        setAnalyzeOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [analyzeOpen])

  // Escape closes dropdowns
  useEffect(() => {
    if (!analyzeOpen && !statsOpen && !rhythmOpen) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { setAnalyzeOpen(false); setStatsOpen(false); setRhythmOpen(false) }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [analyzeOpen, statsOpen, rhythmOpen])

  // Click-outside closes rhythm popover
  useEffect(() => {
    if (!rhythmOpen) return
    const handler = (e: MouseEvent): void => {
      if (
        !rhythmButtonRef.current?.contains(e.target as Node) &&
        !rhythmMenuRef.current?.contains(e.target as Node)
      ) setRhythmOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [rhythmOpen])

  // Click-outside closes stats popover
  useEffect(() => {
    if (!statsOpen) return
    const handler = (e: MouseEvent): void => {
      if (
        !statsButtonRef.current?.contains(e.target as Node) &&
        !statsMenuRef.current?.contains(e.target as Node)
      ) setStatsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [statsOpen])

  const hasFile = Boolean(activeFilePath)
  const isStoryBible = activeFilePath?.endsWith('Story Bible.md') ?? false

  const runBibleGeneration = async (prompt: string): Promise<void> => {
    if (!activeFilePath || isAILoading) return
    setAIError(null)
    setRightPanelTab('chat')

    streamingContentRef.current = ''
    addUserMessage(prompt)
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
          streamingContentRef.current += chunk
          if (streamingRafRef.current === null) {
            streamingRafRef.current = requestAnimationFrame(() => {
              streamingRafRef.current = null
              setStreamingContent(streamingContentRef.current)
            })
          }
        }
      )

      if (streamingRafRef.current !== null) {
        cancelAnimationFrame(streamingRafRef.current)
        streamingRafRef.current = null
      }
      const finalContent = streamingContentRef.current
      streamingContentRef.current = ''
      if (finalContent.length > 0) {
        finalizeAssistantMessage(finalContent, { bibleGeneration: true })
      }
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

  const runPastProgressive = (): void => {
    if (!hasFile) return
    const found = detectPastProgressive(activeFileContent)
    const existing = useEditorStore.getState().annotations.filter((a) => a.type !== 'past_progressive')
    setAnnotations([...existing, ...found])
    setAnalysisMode('past_progressive')
  }

  const runAIAnalysis = async (mode: 'consistency' | 'style' | 'show_tell' | 'critique' | 'weak_verbs' | 'cliches' | 'past_progressive'): Promise<void> => {
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
            : mode === 'weak_verbs'
              ? 'Please identify sentences in this chapter that use weak verbs (was, were, had, got, seemed, appeared, looked, felt) as the main predicate.'
              : mode === 'cliches'
                ? 'Please identify every cliché and overused phrase in this chapter.'
                : mode === 'past_progressive'
                  ? 'Please identify every past progressive construction (was/were + verb-ing) in this chapter that would be stronger in simple past.'
                  : 'Please give me an honest critique of this chapter.'

    streamingContentRef.current = ''
    addUserMessage(prompt)
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
          streamingContentRef.current += chunk
          if (streamingRafRef.current === null) {
            streamingRafRef.current = requestAnimationFrame(() => {
              streamingRafRef.current = null
              setStreamingContent(streamingContentRef.current)
            })
          }
        }
      )

      if (streamingRafRef.current !== null) {
        cancelAnimationFrame(streamingRafRef.current)
        streamingRafRef.current = null
      }
      const finalContent = streamingContentRef.current
      streamingContentRef.current = ''

      if (finalContent.length > 0) {
        finalizeAssistantMessage(finalContent)

        // Parse annotations from response
        const overrideType =
          mode === 'show_tell' ? 'show_tell' :
          mode === 'weak_verbs' ? 'weak_verbs' :
          mode === 'cliches' ? 'cliches' :
          mode === 'past_progressive' ? 'past_progressive' :
          undefined
        const { annotations: newAnnotations } = parseAnnotationsFromAIResponse(finalContent, activeFileContent, overrideType)
        if (newAnnotations.length > 0) {
          const currentHistory = useEditorStore.getState().chatHistory
          const lastMsg = currentHistory[currentHistory.length - 1]
          const existing = useEditorStore.getState().annotations.filter((a) => a.type !== mode)
          setAnnotations([...existing, ...newAnnotations])
          if (lastMsg?.role === 'assistant') {
            linkAnnotationsToMessage(lastMsg.id, newAnnotations.map(a => a.id))
          }
        }
      }
    } catch (err) {
      setAIError(err instanceof Error ? err.message : 'Analysis failed')
    } finally {
      setAILoading(false)
    }
  }

  const passiveCount = annotations.filter((a) => a.type === 'passive_voice').length
  const pastProgressiveCount = annotations.filter((a) => a.type === 'past_progressive').length
  const weakVerbsCount = annotations.filter((a) => a.type === 'weak_verbs').length
  const clichesCount = annotations.filter((a) => a.type === 'cliches').length
  const consistencyCount = annotations.filter((a) => a.type === 'consistency').length
  const styleCount = annotations.filter((a) => a.type === 'style').length
  const showTellCount = annotations.filter((a) => a.type === 'show_tell').length
  const critiqueCount = annotations.filter((a) => a.type === 'critique').length
  const totalCount = passiveCount + pastProgressiveCount + weakVerbsCount + clichesCount + consistencyCount + styleCount + showTellCount + critiqueCount
  const anyActive = Boolean(analysisMode)
  const docWordCount = countWords(activeFileContent)
  const sentenceStats = activeFileContent ? computeSentenceStats(activeFileContent) : null
  const avgSentenceLen = sentenceStats ? Math.round(sentenceStats.avg * 10) / 10 : null
  const paragraphRhythm = activeFileContent ? computeParagraphRhythm(activeFileContent) : []
  const maxParaWords = paragraphRhythm.length > 0 ? Math.max(...paragraphRhythm.map(p => p.words)) : 1

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
              ref={analyzeButtonRef}
              className={`toolbar-btn toolbar-analyze-btn${anyActive ? ' active' : ''}`}
              onClick={() => setAnalyzeOpen((v) => !v)}
              disabled={!hasFile || isAILoading}
              title="Run analysis on this chapter"
            >
              {isAILoading ? 'Analyzing…' : `Analyze ${analyzeOpen ? '▴' : '▾'}`}
              {totalCount > 0 && !isAILoading && (
                <span className="toolbar-analyze-badge">{totalCount}</span>
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

            {analyzeOpen && analyzeButtonRef.current && createPortal(
              (() => {
                const rect = analyzeButtonRef.current!.getBoundingClientRect()
                return (
                  <div
                    ref={analyzeMenuRef}
                    className="context-menu toolbar-analyze-menu"
                    style={{ top: rect.bottom + 4, left: rect.left }}
                  >
                    <button
                      className={`context-menu-item${analysisMode === 'passive_voice' ? ' active' : ''}`}
                      onClick={() => { setAnalyzeOpen(false); runPassiveVoice() }}
                    >
                      <span>Passive Voice</span>
                      {passiveCount > 0 && <span className="toolbar-analyze-count">{passiveCount}</span>}
                    </button>
                    <button
                      className={`context-menu-item${analysisMode === 'past_progressive' ? ' active' : ''}`}
                      onClick={() => { setAnalyzeOpen(false); runPastProgressive() }}
                    >
                      <span>Past Progressive</span>
                      {pastProgressiveCount > 0 && <span className="toolbar-analyze-count">{pastProgressiveCount}</span>}
                    </button>
                    <button
                      className={`context-menu-item${analysisMode === 'weak_verbs' ? ' active' : ''}`}
                      onClick={() => { setAnalyzeOpen(false); void runAIAnalysis('weak_verbs') }}
                    >
                      <span>Weak Verbs</span>
                      {weakVerbsCount > 0 && <span className="toolbar-analyze-count">{weakVerbsCount}</span>}
                    </button>
                    <button
                      className={`context-menu-item${analysisMode === 'cliches' ? ' active' : ''}`}
                      onClick={() => { setAnalyzeOpen(false); void runAIAnalysis('cliches') }}
                    >
                      <span>Clichés</span>
                      {clichesCount > 0 && <span className="toolbar-analyze-count">{clichesCount}</span>}
                    </button>
                    <button
                      className={`context-menu-item${analysisMode === 'consistency' ? ' active' : ''}`}
                      onClick={() => { setAnalyzeOpen(false); void runAIAnalysis('consistency') }}
                    >
                      <span>Consistency</span>
                      {consistencyCount > 0 && <span className="toolbar-analyze-count">{consistencyCount}</span>}
                    </button>
                    <button
                      className={`context-menu-item${analysisMode === 'style' ? ' active' : ''}`}
                      onClick={() => { setAnalyzeOpen(false); void runAIAnalysis('style') }}
                    >
                      <span>Style</span>
                      {styleCount > 0 && <span className="toolbar-analyze-count">{styleCount}</span>}
                    </button>
                    <button
                      className={`context-menu-item${analysisMode === 'show_tell' ? ' active' : ''}`}
                      onClick={() => { setAnalyzeOpen(false); void runAIAnalysis('show_tell') }}
                    >
                      <span>Show vs Tell</span>
                      {showTellCount > 0 && <span className="toolbar-analyze-count">{showTellCount}</span>}
                    </button>
                    <button
                      className={`context-menu-item${analysisMode === 'critique' ? ' active' : ''}`}
                      onClick={() => { setAnalyzeOpen(false); void runAIAnalysis('critique') }}
                    >
                      <span>Critique</span>
                      {critiqueCount > 0 && <span className="toolbar-analyze-count">{critiqueCount}</span>}
                    </button>
                  </div>
                )
              })(),
              document.body
            )}
          </>
        )}
      </div>

      <div className="toolbar-right">
        <button
          className={`toolbar-btn toolbar-btn-outline${revisionPanelOpen ? ' active' : ''}`}
          onClick={toggleRevisionPanel}
          title="Revision history"
        >
          ⟳
        </button>
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
        {selectionWordCount !== null && (
          <span className="toolbar-selection-wordcount" title={`${selectionWordCount} words selected`}>
            {formatWordCount(selectionWordCount)} sel
          </span>
        )}
        {activeFilePath && paragraphRhythm.length > 0 && (
          <>
            <button
              ref={rhythmButtonRef}
              className={`toolbar-btn toolbar-btn-outline${rhythmOpen ? ' active' : ''}`}
              onClick={() => setRhythmOpen(v => !v)}
              title="Paragraph rhythm — sentence count per paragraph"
            >
              ∿
            </button>
            {rhythmOpen && rhythmButtonRef.current && createPortal(
              (() => {
                const rect = rhythmButtonRef.current!.getBoundingClientRect()
                return (
                  <div
                    ref={rhythmMenuRef}
                    className="toolbar-rhythm-popover"
                    style={{ top: rect.bottom + 4, right: window.innerWidth - rect.right }}
                  >
                    <div className="toolbar-stats-header">
                      <span className="toolbar-stats-title">Paragraph Rhythm</span>
                      <button className="toolbar-stats-close" onClick={() => setRhythmOpen(false)}>×</button>
                    </div>
                    <div className="toolbar-stats-summary">
                      <span><strong>{paragraphRhythm.length}</strong> paragraphs</span>
                      <span>avg <strong>{Math.round(paragraphRhythm.reduce((s, p) => s + p.sentences, 0) / paragraphRhythm.length * 10) / 10}</strong> sentences</span>
                    </div>
                    <div className="toolbar-rhythm-list">
                      {paragraphRhythm.map((p, i) => {
                        const barW = Math.max(12, Math.round((p.words / maxParaWords) * 180))
                        const color = sentenceCountColor(p.sentences)
                        const preview = p.text.length > 80 ? p.text.slice(0, 80) + '…' : p.text
                        return (
                          <div
                            key={i}
                            className="toolbar-rhythm-row"
                            title={`${p.sentences} sentence${p.sentences !== 1 ? 's' : ''} · ${p.words} words\n${preview}`}
                          >
                            <div
                              className="toolbar-rhythm-bar"
                              style={{ width: barW, background: color }}
                            />
                            <span className="toolbar-rhythm-count" style={{ color }}>{p.sentences}</span>
                          </div>
                        )
                      })}
                    </div>
                    <div className="toolbar-rhythm-legend">
                      {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                        <div key={n} className="toolbar-rhythm-legend-item" title={`${n}${n === 8 ? '+' : ''} sentence${n !== 1 ? 's' : ''}`}>
                          <div className="toolbar-rhythm-legend-swatch" style={{ background: sentenceCountColor(n) }} />
                          <span>{n}{n === 8 ? '+' : ''}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })(),
              document.body
            )}
          </>
        )}

        {activeFilePath && sentenceStats && (
          <>
            <button
              ref={statsButtonRef}
              className={`toolbar-btn toolbar-btn-stats${statsOpen ? ' active' : ''}`}
              onClick={() => setStatsOpen(v => !v)}
              title="Sentence length histogram"
            >
              ≈
            </button>
            {statsOpen && statsButtonRef.current && createPortal(
              (() => {
                const rect = statsButtonRef.current!.getBoundingClientRect()
                const maxBin = Math.max(...sentenceStats.bins, 1)
                const CHART_H = 60
                return (
                  <div
                    ref={statsMenuRef}
                    className="toolbar-stats-popover"
                    style={{ top: rect.bottom + 4, right: window.innerWidth - rect.right }}
                  >
                    <div className="toolbar-stats-header">
                      <span className="toolbar-stats-title">Sentence Lengths</span>
                      <button className="toolbar-stats-close" onClick={() => setStatsOpen(false)}>×</button>
                    </div>
                    <div className="toolbar-stats-summary">
                      <span>avg <strong>{Math.round(sentenceStats.avg * 10) / 10}w</strong></span>
                      <span>σ <strong>{Math.round(sentenceStats.stdDev * 10) / 10}</strong></span>
                      <span><strong>{sentenceStats.totalSentences}</strong> sentences</span>
                    </div>
                    <div className="toolbar-stats-chart" style={{ height: CHART_H }}>
                      {sentenceStats.bins.map((count, i) => {
                        const wordCount = i + 1
                        const isTarget = wordCount >= 11 && wordCount <= 16
                        const barH = count === 0 ? 0 : Math.max(2, Math.round((count / maxBin) * CHART_H))
                        return (
                          <div
                            key={i}
                            className={`toolbar-stats-bar${isTarget ? ' target' : ''}`}
                            style={{ height: barH }}
                            title={`${wordCount === 31 ? '31+' : wordCount}w: ${count} sentence${count !== 1 ? 's' : ''}`}
                          />
                        )
                      })}
                    </div>
                    <div className="toolbar-stats-axis">
                      <span>1</span>
                      <span>8</span>
                      <span className="toolbar-stats-axis-target">11–16 ●</span>
                      <span>22</span>
                      <span>31+</span>
                    </div>
                    {sentenceStats.outliers.length > 0 && (
                      <div className="toolbar-stats-outliers">
                        <div className="toolbar-stats-outliers-title">
                          Flagged (≤4 or ≥26 words)
                        </div>
                        <div className="toolbar-stats-outliers-list">
                          {sentenceStats.outliers.slice(0, 8).map((o, i) => (
                            <div key={i} className="toolbar-stats-outlier">
                              <span className="toolbar-stats-outlier-wc">{o.wordCount}w</span>
                              <span className={`toolbar-stats-outlier-text${o.wordCount <= 4 ? ' short' : ' long'}`}>
                                {o.text.length > 55 ? o.text.slice(0, 55) + '…' : o.text}
                              </span>
                            </div>
                          ))}
                          {sentenceStats.outliers.length > 8 && (
                            <div className="toolbar-stats-outlier-more">
                              +{sentenceStats.outliers.length - 8} more
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })(),
              document.body
            )}
          </>
        )}
        {activeFilePath && (
          <span
            className="toolbar-wordcount"
            title={`This document: ${docWordCount.toLocaleString()} words · Entire project: ${projectWordCount.toLocaleString()} words${avgSentenceLen !== null ? ` · Avg sentence: ${avgSentenceLen} words` : ''}`}
          >
            {formatWordCount(docWordCount)}
            <span className="toolbar-wordcount-sep">/</span>
            {formatWordCount(projectWordCount)}
            {avgSentenceLen !== null && (
              <>
                <span className="toolbar-wordcount-sep">·</span>
                {avgSentenceLen}w
              </>
            )}
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
