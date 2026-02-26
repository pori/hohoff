import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './ContextMenu.css'

export interface MenuItem {
  label: string
  action: () => void
  danger?: boolean
  disabled?: boolean
}

interface Props {
  x: number
  y: number
  items: (MenuItem | 'separator')[]
  onClose: () => void
}

const MARGIN = 6 // min gap from viewport edges (px)

export function ContextMenu({ x, y, items, onClose }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [adjPos, setAdjPos] = useState({ x, y })
  const [ready, setReady] = useState(false)

  // After the menu is in the DOM, measure it and clamp so it stays on screen.
  // useLayoutEffect runs synchronously before the browser paints, so the menu
  // is never visible in the wrong position.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const adjX = Math.max(MARGIN, Math.min(x, window.innerWidth  - width  - MARGIN))
    const adjY = Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN))
    setAdjPos({ x: adjX, y: adjY })
    setReady(true)
  }, [x, y])

  useEffect(() => {
    function handlePointerDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return createPortal(
    <div
      className="context-menu"
      style={{ left: adjPos.x, top: adjPos.y, visibility: ready ? 'visible' : 'hidden' }}
      ref={ref}
    >
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="context-menu-separator" />
        ) : (
          <button
            key={i}
            className={`context-menu-item${item.danger ? ' danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.action()
            }}
          >
            {item.label}
          </button>
        )
      )}
    </div>,
    document.body
  )
}
