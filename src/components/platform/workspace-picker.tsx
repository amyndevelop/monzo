'use client';
import { useState } from 'react';
import { navigateWithFreshDocument } from '@/modules/auth/navigation';
import { Building2, ArrowRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
export type WorkspaceOption = { role: string; tenant: { id: string; name: string; slug: string } };
async function post(path: string, data: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'No pudimos completar la operación.');
  return body;
}
export function WorkspacePicker({ memberships }: { memberships: WorkspaceOption[] }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function activate(id: string) {
    await post('/api/workspaces/active', { tenantId: id });
    navigateWithFreshDocument('/dashboard');
  }
  return (
    <>
      <div className="workspace-grid">
        {memberships.map(({ tenant, role }) => (
          <button
            className="workspace-card"
            key={tenant.id}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await activate(tenant.id);
              } catch (error) {
                setError(error instanceof Error ? error.message : 'Intentá nuevamente.');
                setBusy(false);
              }
            }}
          >
            <span className="icon-tile">
              <Building2 size={24} />
            </span>
            <strong>{tenant.name}</strong>
            <small>
              {role === 'OWNER' ? 'Propietario' : role === 'ADMIN' ? 'Administrador' : 'Miembro'}
            </small>
            <span>
              Entrar a la empresa <ArrowRight size={16} />
            </span>
          </button>
        ))}
      </div>
      {!memberships.length && (
        <div className="empty-workspaces">
          <Building2 size={32} />
          <h2>Tu primera conexión está por empezar.</h2>
          <p>Creá una empresa para abrir tu espacio de trabajo.</p>
        </div>
      )}
      <section className="create-workspace">
        <div>
          <p className="eyebrow">UN ESPACIO INDEPENDIENTE</p>
          <h2>Creá una empresa</h2>
          <p>Vos serás su propietario. Podrás invitar a tu equipo después.</p>
        </div>
        <form
          className="account-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            const data = new FormData(event.currentTarget);
            try {
              const tenant = await post('/api/workspaces', { name: data.get('name') });
              await activate(tenant.id);
            } catch (error) {
              setError(error instanceof Error ? error.message : 'Intentá nuevamente.');
              setBusy(false);
            }
          }}
        >
          <label>
            Nombre de la empresa
            <input
              name="name"
              minLength={2}
              maxLength={80}
              required
              placeholder="El nombre de tu negocio"
            />
          </label>
          <Button disabled={busy} type="submit">
            <Plus size={17} />
            {busy ? 'Preparando…' : 'Crear empresa'}
          </Button>
        </form>
      </section>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </>
  );
}
export function WorkspaceSwitcher({
  memberships,
  activeId,
}: {
  memberships: WorkspaceOption[];
  activeId: string;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="live-workspace-switch">
      <label htmlFor="workspace-switch">Empresa activa</label>
      <select
        id="workspace-switch"
        value={activeId}
        disabled={busy}
        onChange={async (event) => {
          setBusy(true);
          try {
            await post('/api/workspaces/active', { tenantId: event.target.value });
            navigateWithFreshDocument('/dashboard');
          } catch {
            setError('No pudimos cambiar de empresa.');
            setBusy(false);
          }
        }}
      >
        {memberships.map(({ tenant }) => (
          <option key={tenant.id} value={tenant.id}>
            {tenant.name}
          </option>
        ))}
      </select>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
