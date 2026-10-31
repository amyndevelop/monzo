'use client';
import { useEffect, useRef, useState } from 'react';
import { X, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  resolveConditions,
  renderFlowText,
  captureAnswer,
  type FlowVariables,
  type FlowGraph,
} from '@/modules/automations/definition';
export function FlowSimulator({ graph, onClose }: { graph: FlowGraph; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const question = useRef<HTMLParagraphElement>(null);
  const chat = useRef<HTMLDivElement>(null);
  const [nodeId, setNodeId] = useState(graph.start);
  const [variables, setVariables] = useState<FlowVariables>({});
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<{ text: string; user?: boolean }[]>([]);
  const node = resolveConditions(graph, nodeId, variables);
  const text = renderFlowText(node.text, variables);
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
          {text}
          {node.kind === 'message' ? '\n\nEscribí MENÚ para volver al inicio.' : ''}
        </p>
        {node.kind === 'capture' ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const value = captureAnswer(answer);
              if (!value) {
                setError('Ingresá un texto de 1 a 120 caracteres, sin saltos de línea.');
                return;
              }
              setHistory([...history, { text }, { text: value, user: true }]);
              setVariables({ ...variables, [node.variable!]: value });
              setNodeId(node.options[0].next);
              setAnswer('');
              setError('');
            }}
          >
            <label>
              Respuesta de prueba
              <input
                autoComplete="off"
                maxLength={120}
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
              />
            </label>
            <Button type="submit">Continuar</Button>
            {error && <p role="alert">{error}</p>}
          </form>
        ) : node.kind === 'menu' ? (
          <div className="flow-simulator-options">
            {node.options.map((option) => (
              <Button
                key={option.id}
                type="button"
                variant="outline"
                onClick={() => {
                  setHistory([...history, { text }, { text: option.label, user: true }]);
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
            setVariables({});
            setAnswer('');
            setError('');
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
