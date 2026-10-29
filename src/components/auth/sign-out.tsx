'use client';
import { useState } from 'react';
import { navigateWithFreshDocument } from '@/modules/auth/navigation';
import { authClient } from '@/modules/auth/client';
import { Button } from '@/components/ui/button';
export function SignOut() {
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(false);
          try {
            const result = await authClient.signOut();
            if (result.error) throw new Error();
            navigateWithFreshDocument('/ingresar');
          } catch {
            setError(true);
            setBusy(false);
          }
        }}
      >
        {busy ? 'Saliendo…' : 'Cerrar sesión'}
      </Button>
      {error && <span role="alert">No pudimos cerrar la sesión. Intentá nuevamente.</span>}
    </div>
  );
}
