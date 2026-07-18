import Editor from '@monaco-editor/react';

interface CodeEditorProps {
  id: string;
  value: string;
  language?: string;
  readOnly?: boolean;
  height?: string;
  onChange?: (value: string) => void;
}

export default function CodeEditor({
  id,
  value,
  language = 'typescript',
  readOnly = true,
  height = '300px',
  onChange,
}: CodeEditorProps) {
  return (
    <div id={id} className="code-editor">
      <Editor
        height={height}
        language={language}
        value={value}
        theme="vs-dark"
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: 'JetBrains Mono, monospace',
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          padding: { top: 12 },
          renderLineHighlight: 'line',
        }}
        onChange={(v) => onChange?.(v || '')}
      />
    </div>
  );
}