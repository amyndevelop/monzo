'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
type Member = {
  id: string;
  role: string;
  user: { id: string; name: string | null; email: string };
};
export function TeamManager({
  tenantId,
  members,
  owner,
}: {
  tenantId: string;
  members: Member[];
  owner: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function mutate(path: string, method: string, data: unknown) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      router.refresh();
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No pudimos completar la operación.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="team-list" aria-label="Miembros de la empresa">
        {members.map((member) => (
          <article className="member-row" key={member.id}>
            <div>
              <strong>{member.user.name ?? 'Integrante'}</strong>
              <p>{member.user.email}</p>
            </div>
            {owner ? (
              <div className="member-controls">
                <label className="sr-only" htmlFor={`role-${member.id}`}>
                  Rol de {member.user.email}
                </label>
                <select
                  id={`role-${member.id}`}
                  value={member.role}
                  disabled={busy}
                  onChange={(event) =>
                    void mutate(`/api/workspaces/${tenantId}/members/${member.id}`, 'PATCH', {
                      role: event.target.value,
                    })
                  }
                >
                  <option value="OWNER">Propietario</option>
                  <option value="ADMIN">Administrador</option>
                  <option value="MEMBER">Miembro</option>
                </select>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        `¿Quitar el acceso de ${member.user.name ?? member.user.email} a esta empresa?`,
                      )
                    )
                      void mutate(`/api/workspaces/${tenantId}/members/${member.id}`, 'DELETE', {});
                  }}
                >
                  Quitar acceso
                </Button>
              </div>
            ) : (
              <span className="small-badge">
                {member.role === 'OWNER'
                  ? 'Propietario'
                  : member.role === 'ADMIN'
                    ? 'Administrador'
                    : 'Miembro'}
              </span>
            )}
          </article>
        ))}
      </section>
      {owner ? (
        <section className="invite-card">
          <h2>Una invitación para conectar</h2>
          <p>
            La persona deberá verificar ese correo antes de unirse. El enlace vence en 48 horas.
          </p>
          <form
            className="account-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              if (
                await mutate(`/api/workspaces/${tenantId}/invitations`, 'POST', {
                  email: data.get('email'),
                  role: data.get('role'),
                })
              )
                setMessage('La invitación se envió por correo.');
            }}
          >
            <label>
              Correo de la persona
              <input name="email" type="email" maxLength={254} required />
            </label>
            <label>
              Rol inicial
              <select name="role">
                <option value="MEMBER">Miembro</option>
                <option value="ADMIN">Administrador</option>
              </select>
            </label>
            <Button disabled={busy} type="submit">
              {busy ? 'Procesando…' : 'Enviar invitación'}
            </Button>
          </form>
        </section>
      ) : (
        <p className="form-message">
          Solo los propietarios pueden invitar personas, cambiar roles o quitar accesos.
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="form-message">
          {message}
        </p>
      )}
    </>
  );
}
