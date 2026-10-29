'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
export function SettingsForm({
  tenantId,
  name,
  timezone,
  locale,
  canEdit,
}: {
  tenantId: string;
  name: string;
  timezone: string;
  locale: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="account-form settings-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        setMessage('');
        const data = new FormData(event.currentTarget);
        try {
          const response = await fetch(`/api/workspaces/${tenantId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: data.get('name'),
              timezone: data.get('timezone'),
              locale: data.get('locale'),
            }),
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error);
          setMessage('Los cambios se guardaron.');
          router.refresh();
        } catch (error) {
          setError(error instanceof Error ? error.message : 'No pudimos guardar los cambios.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Nombre de la empresa
        <input
          name="name"
          defaultValue={name}
          minLength={2}
          maxLength={80}
          disabled={!canEdit}
          required
        />
      </label>
      <label>
        Zona horaria
        <input
          name="timezone"
          defaultValue={timezone}
          disabled={!canEdit}
          maxLength={100}
          required
        />
        <small>Por ejemplo: America/Argentina/Buenos_Aires.</small>
      </label>
      <label>
        Idioma
        <select name="locale" defaultValue={locale} disabled={!canEdit}>
          <option value="es-AR">Español (Argentina)</option>
          <option value="es">Español</option>
          <option value="en">English</option>
          <option value="pt-BR">Português (Brasil)</option>
        </select>
      </label>
      {canEdit ? (
        <Button type="submit" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      ) : (
        <p className="form-message">
          Tu rol permite ver estas preferencias. Un propietario o administrador puede modificarlas.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="form-message" role="status">
          {message}
        </p>
      )}
    </form>
  );
}
