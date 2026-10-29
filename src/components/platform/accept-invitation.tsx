'use client';
import { useState } from 'react';
import { navigateWithFreshDocument } from '@/modules/auth/navigation';
import { Button } from '@/components/ui/button';
export function AcceptInvitation({ token }: { token?: string }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <Button
        disabled={!token || busy}
        onClick={async () => {
          setBusy(true);
          try {
            const response = await fetch('/api/invitations/accept', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token }),
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error);
            navigateWithFreshDocument('/empresas');
          } catch (error) {
            setError(error instanceof Error ? error.message : 'No pudimos aceptar la invitación.');
            setBusy(false);
          }
        }}
      >
        {busy ? 'Procesando…' : 'Aceptar invitación'}
      </Button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
