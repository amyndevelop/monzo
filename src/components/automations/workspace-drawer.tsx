'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
export function WorkspaceDrawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const element = ref.current!,
      previous = document.activeElement;
    element.showModal();
    element.querySelector<HTMLHeadingElement>('h2')?.focus();
    return () => {
      element.close();
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        previous.getClientRects().length
      )
        previous.focus();
    };
  }, [open]);
  // Children stay mounted to preserve catalog forms and unsaved data when the panel is closed.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <dialog
      ref={ref}
      className="flow-drawer"
      aria-label={title}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 tabIndex={-1}>{title}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Cerrar ${title.toLowerCase()}`}
          onClick={onClose}
        >
          <X size={20} />
        </Button>
      </header>
      <div className="flow-drawer-body">{children}</div>
    </dialog>,
    document.body,
  );
}
