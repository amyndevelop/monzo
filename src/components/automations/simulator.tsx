'use client';
import { useEffect, useRef, useState } from 'react';
import { X, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { advanceFlow, type EngineResult } from '@/modules/automations/engine';
import type { FlowGraph } from '@/modules/automations/definition';
export function FlowSimulator({ graph, onClose }: { graph: FlowGraph; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null),
    question = useRef<HTMLParagraphElement>(null),
    chat = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<EngineResult>(() => advanceFlow(graph, null, { text: '' }));
  const [answer, setAnswer] = useState(''),
    [history, setHistory] = useState<{ text: string; user?: boolean }[]>([]);
  useEffect(() => {
    const el = dialog.current!,
      previous = document.activeElement;
    el.showModal();
    return () => {
      el.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    question.current?.focus();
    if (chat.current) chat.current.scrollTop = chat.current.scrollHeight;
  }, [state]);
  function reply(text: string, optionId?: string) {
    setHistory((h) => [...h, { text: state.text }, { text, user: true }]);
    setState(advanceFlow(graph, state, { text, optionId }));
    setAnswer('');
  }
  return (
    <dialog
      ref={dialog}
      className="flow-simulator"
      aria-labelledby="flow-simulator-title"
      onCancel={(e) => {
        e.preventDefault();
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
          {state.text}
          {state.node.kind === 'message' ? '\n\nEscribí MENÚ para volver al inicio.' : ''}
        </p>
        {state.reason && <p className="flow-simulator-outcome">Para el equipo: {state.reason}</p>}
        {state.node.kind === 'capture' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              reply(answer);
            }}
          >
            <label>
              Respuesta de prueba
              <input
                autoComplete="off"
                maxLength={120}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
              />
            </label>
            <Button type="submit">Continuar</Button>
          </form>
        ) : state.node.kind === 'menu' ? (
          <div className="flow-simulator-options">
            {state.node.options.map((option) => (
              <Button
                key={option.id}
                type="button"
                variant="outline"
                onClick={() => reply(option.label, option.id)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        ) : (
          <p className="flow-simulator-outcome">
            {['handoff', 'blocked'].includes(state.status)
              ? 'La automatización se detiene y la conversación queda para el equipo.'
              : 'Fin de este recorrido. El cliente puede escribir MENÚ para empezar de nuevo.'}
          </p>
        )}
        <details className="variable-preview">
          <summary>Valores de esta ejecución</summary>
          {Object.keys(state.variables).length ? (
            <dl>
              {Object.entries(state.variables).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{value || 'Vacío'}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>Sin valores guardados.</p>
          )}
          <p>Turno {state.turns} / 100. Las correcciones conservan los otros valores.</p>
        </details>
      </div>
      <footer>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setHistory([]);
            setAnswer('');
            setState(advanceFlow(graph, null, { text: '' }));
          }}
        >
          <RotateCcw size={15} />
          Volver al inicio
        </Button>
      </footer>
    </dialog>
  );
}
