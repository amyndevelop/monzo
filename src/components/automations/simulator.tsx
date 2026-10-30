'use client';
import { useEffect, useRef, useState } from 'react';
import { X, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { FlowGraph } from '@/modules/automations/definition';
export function FlowSimulator({ graph, onClose }: { graph: FlowGraph; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const question = useRef<HTMLParagraphElement>(null);
  const chat = useRef<HTMLDivElement>(null);
  const [nodeId, setNodeId] = useState(graph.start);
  const [history, setHistory] = useState<{ text: string; user?: boolean }[]>([]);
  const node = graph.nodes.find((n) => n.id === nodeId)!;
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    question.current?.focus();
    if (chat.current) chat.current.scrollTop = chat.current.scrollHeight;
  }, [nodeId, history.length]);
  return (
    <dialog
      ref={dialog}
      className="flow-simulator"
      aria-labelledby="flow-simulator-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <div>
          <h2 id="flow-simulator-title">Probar recorrido</h2>
          <p>Simulación local · No envía mensajes.</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Cerrar simulador"
          onClick={onClose}
        >
          <X size={20} />
        </Button>
      </header>
      <div className="flow-simulator-chat" ref={chat} aria-live="polite">
        {history.map((entry, i) => (
          <p key={i} className={entry.user ? 'user' : ''}>
            {entry.text}
          </p>
        ))}
        <p ref={question} tabIndex={-1}>
          {node.text}
          {node.kind === 'message' ? '\n\nEscribí MENÚ para volver al inicio.' : ''}
        </p>
        {node.kind === 'menu' ? (
          <div className="flow-simulator-options">
            {node.options.map((option) => (
              <Button
                key={option.id}
                type="button"
                variant="outline"
                onClick={() => {
                  setHistory([...history, { text: node.text }, { text: option.label, user: true }]);
                  setNodeId(option.next);
                }}
              >
                {option.label}
              </Button>
            ))}
          </div>
        ) : (
          <p className="flow-simulator-outcome">
            {node.kind === 'handoff'
              ? 'La automatización se detiene y la conversación queda para el equipo.'
              : 'Fin de este recorrido. El cliente puede escribir MENÚ para empezar de nuevo.'}
          </p>
        )}
      </div>
      <footer>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setHistory([]);
            setNodeId(graph.start);
          }}
        >
          <RotateCcw size={15} />
          Volver al inicio
        </Button>
      </footer>
    </dialog>
  );
}
