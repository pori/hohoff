# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hohoff Editor — an Electron desktop app for novel editing with AI-powered writing analysis. Built with React 18, TypeScript, CodeMirror 6, and Zustand. Uses the Anthropic Claude API for chat and text analysis features.

## Commands

- `npm run dev` — Start Electron dev server with hot reload
- `npm run build` — Production build (outputs to `out/`)
- `npm run typecheck` — Type-check both Node and browser TypeScript configs
- `npm run preview` — Preview production build

No test runner or linter is configured.

## Architecture

**Electron three-process model:**

- **Main process** (`src/main/`) — Node.js environment. Handles file I/O (`fileSystem.ts`), Claude API streaming (`aiService.ts`), and IPC handlers (`ipcHandlers.ts`).
- **Preload** (`src/preload/index.ts`) — Bridges main↔renderer via `contextBridge`. Exposes `window.api.*` methods.
- **Renderer** (`src/renderer/`) — React app with CodeMirror editor. All file/AI operations go through `window.api.*` IPC calls, never direct Node access.

**State management:** Single Zustand store (`src/renderer/store/editorStore.ts`) holds all app state — active file, chat history (per-file), annotations (per-file), UI preferences. State auto-persists to `.session.json` in the draft directory with 1500ms debounce.

**Key renderer components:**

| Directory | Purpose |
|-----------|---------|
| `components/Editor/` | CodeMirror 6 markdown editor with custom annotation decorations and theme compartments |
| `components/AIChat/` | Streaming chat interface, per-file conversation history, attachment support (images/PDF/text) |
| `components/Feedback/` | AI annotation panel — highlights parsed from AI responses, hover tooltips, one-click apply |
| `components/FileTree/` | Drag-and-drop file navigation with custom ordering (`.order.json`) |
| `components/Revisions/` | Version history with word count tracking, stored in `.revisions/` directory |
| `components/Toolbar/` | Analysis mode triggers (passive voice, consistency, style, critique) |

## Key Patterns

**IPC flow:** Renderer calls `window.api.method()` → preload forwards via `ipcRenderer.invoke()` → main process handler in `ipcHandlers.ts` executes and returns result. AI streaming uses event-based IPC (`ai:chunk` events).

**CodeMirror annotations:** Custom `StateField` tracks annotation positions. Positions are remapped through document changes via `tr.changes.mapPos()`. Annotations auto-dismiss 1.2s after the user edits the annotated region. Apply/dismiss actions integrate with CodeMirror undo history via `invertedEffects`.

**Annotation parsing** (`src/renderer/utils/annotationParser.ts`): AI responses are parsed for quoted text, which is matched against document content (exact match first, then normalized whitespace fallback). Each quote becomes a positioned annotation with type, message, and optional suggestion.

**Path alias:** `@renderer/*` resolves to `src/renderer/*` (configured in both Vite and tsconfig.web.json).

## Environment

Requires `.env.local` in project root with:
- `ANTHROPIC_API_KEY` — Claude API key
- `DRAFT_PATH` — Absolute path to the directory containing markdown draft files

## TypeScript Configuration

Two separate tsconfig files referenced from root `tsconfig.json`:
- `tsconfig.node.json` — Main and preload processes (Node.js environment)
- `tsconfig.web.json` — Renderer process (browser environment, has `@renderer/*` path alias)
