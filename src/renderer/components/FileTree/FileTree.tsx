import { useEditorStore } from '../../store/editorStore'
import { FileTreeNode } from './FileTreeNode'
import './FileTree.css'

export function FileTree(): JSX.Element {
  const { fileTree } = useEditorStore()

  return (
    <nav className="file-tree">
      <div className="file-tree-header">HOHOFF</div>
      <div className="file-tree-list">
        {fileTree.map((node) => (
          <FileTreeNode key={node.path} node={node} depth={0} />
        ))}
      </div>
    </nav>
  )
}
