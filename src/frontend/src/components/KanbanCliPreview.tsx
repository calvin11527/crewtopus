import { Terminal } from 'lucide-react';

interface KanbanCliPreviewProps {
  lines: string[];
}

export default function KanbanCliPreview({ lines }: KanbanCliPreviewProps) {
  if (lines.length === 0) return null;

  return (
    <div className="kanban-cli-preview" title="Live CLI output">
      <div className="kanban-cli-preview-header">
        <Terminal size={10} />
        <span>live</span>
      </div>
      <pre className="kanban-cli-preview-body">
        {lines.map((line, i) => (
          <span key={`${i}-${line.slice(0, 12)}`} className="kanban-cli-preview-line">
            {line}
          </span>
        ))}
      </pre>
    </div>
  );
}