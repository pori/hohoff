import { useState } from 'react'
import { useEditorStore } from '../../store/editorStore'
import type { FileNode } from '../../types/editor'

interface DndPayload {
  name: string
  dirPath: string
}

interface Props {
  node: FileNode
  depth: number
  dirPath: string
  siblings: FileNode[]
}

export function FileTreeNode({ node, depth, dirPath, siblings }: Props): JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const { activeFilePath, setActiveFile, moveNode } = useEditorStore()

  const openFile = async (): Promise<void> => {
    if (node.type === 'file') {
      const content = await window.api.readFile(node.path)
      setActiveFile(node.path, content)
    }
  }

  function handleDragStart(e: React.DragEvent<HTMLElement>): void {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('dnd', JSON.stringify({ name: node.name, dirPath } satisfies DndPayload))
    e.currentTarget.classList.add('dragging')
  }

  function handleDragEnd(e: React.DragEvent<HTMLElement>): void {
    e.currentTarget.classList.remove('dragging')
  }

  function handleDragOver(e: React.DragEvent<HTMLElement>): void {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    e.currentTarget.classList.add('drag-over')
  }

  function handleDragLeave(e: React.DragEvent<HTMLElement>): void {
    e.currentTarget.classList.remove('drag-over')
  }

  function handleDrop(e: React.DragEvent<HTMLElement>): void {
    e.preventDefault()
    e.currentTarget.classList.remove('drag-over')
    const raw = e.dataTransfer.getData('dnd')
    if (!raw) return
    const payload: DndPayload = JSON.parse(raw)
    if (payload.dirPath !== dirPath) return
    const fromIdx = siblings.findIndex((n) => n.name === payload.name)
    const toIdx = siblings.findIndex((n) => n.name === node.name)
    if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
      moveNode(dirPath, fromIdx, toIdx)
    }
  }

  if (node.type === 'directory') {
    return (
      <div className="tree-dir">
        <button
          className="tree-dir-header"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
          draggable={true}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <span className="tree-arrow">{expanded ? '▾' : '▸'}</span>
          {node.name}
        </button>
        {expanded && node.children?.map((child) => (
          <FileTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            dirPath={node.path}
            siblings={node.children!}
          />
        ))}
      </div>
    )
  }

  const isActive = activeFilePath === node.path

  return (
    <button
      className={`tree-file${isActive ? ' active' : ''}`}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
      onClick={openFile}
      title={node.name}
      draggable={true}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {node.name}
    </button>
  )
}
