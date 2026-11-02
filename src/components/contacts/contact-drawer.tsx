'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { WorkspaceDrawer } from '@/components/automations/workspace-drawer';
import { Button } from '@/components/ui/button';
import { whatsappRequest } from '@/components/whatsapp/http';
import { salesStages, type ContactDetail, type SalesStage } from '@/modules/contacts/types';
export function ContactDrawer({
  tenantId,
  contactId,
  onClose,
  onSaved,
}: {
  tenantId: string;
  contactId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [detail, setDetail] = useState<ContactDetail | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const dirty = useRef(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void whatsappRequest<ContactDetail>(
      `/api/workspaces/${tenantId}/contacts/${contactId}`,
      'GET',
      undefined,
      controller.signal,
    )
      .then((data) => {
        if (active) {
          setDetail(data);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'No pudimos cargar la ficha.');
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [tenantId, contactId, attempt]);
  return (
    <WorkspaceDrawer
      open
      title="Ficha del contacto"
      onClose={() => {
        if (!dirty.current || window.confirm('Tenés cambios sin guardar. ¿Cerrar y descartarlos?'))
          onClose();
      }}
    >
      {!detail ? (
        <div>
          <p role={error ? 'alert' : 'status'}>{error || 'Cargando ficha…'}</p>
          {error && (
            <Button
              variant="outline"
              onClick={() => {
                setError('');
                setAttempt((v) => v + 1);
              }}
            >
              Reintentar
            </Button>
          )}
        </div>
      ) : (
        <ProfileForm
          tenantId={tenantId}
          initial={detail}
          onDirty={(value) => {
            dirty.current = value;
          }}
          onSaved={onSaved}
        />
      )}
    </WorkspaceDrawer>
  );
}
function ProfileForm({
  tenantId,
  initial,
  onDirty,
  onSaved,
}: {
  tenantId: string;
  initial: ContactDetail;
  onDirty: (value: boolean) => void;
  onSaved?: () => void;
}) {
  const [detail, setDetail] = useState(initial);
  const [form, setForm] = useState(() => fields(initial));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function fields(d: ContactDetail) {
    const c = d.contact;
    return {
      crmName: c.crmName ?? '',
      email: c.email ?? '',
      company: c.company ?? '',
      salesStage: c.salesStage,
      tags: c.tags.join(', '),
      ownerUserId: c.ownerUserId ?? '',
      profileNotes: c.profileNotes ?? '',
    };
  }
  function change<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
    onDirty(true);
    setNotice('');
  }
  const c = detail.contact;
  return (
    <form
      className="crm-profile"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        setNotice('');
        try {
          const result = await whatsappRequest<ContactDetail>(
            `/api/workspaces/${tenantId}/contacts/${c.id}`,
            'PATCH',
            {
              ...form,
              tags: form.tags
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean),
              ownerUserId: form.ownerUserId || null,
              crmRevision: c.crmRevision,
            },
          );
          setDetail(result);
          setForm(fields(result));
          setDirty(false);
          onDirty(false);
          setNotice('Ficha guardada.');
          onSaved?.();
        } catch (e) {
          setError(e instanceof Error ? e.message : 'No pudimos guardar la ficha.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="crm-fields">
        <div className="crm-identity">
          <strong>+{c.waId}</strong>
          <span>WhatsApp: {c.name ?? 'Sin nombre de perfil'}</span>
          <small>Canal: {c.account.displayPhone}</small>
          {c.conversations[0] && (
            <Link
              href={`/dashboard/conversaciones?conversation=${c.conversations[0].id}`}
              onClick={(event) => {
                if (
                  dirty &&
                  !window.confirm('Tenés cambios sin guardar. ¿Abrir el chat y descartarlos?')
                )
                  event.preventDefault();
              }}
            >
              Abrir conversación ↗
            </Link>
          )}
        </div>
        <div className="crm-form-grid">
          <label>
            Nombre en la ficha
            <input
              maxLength={120}
              value={form.crmName}
              onChange={(e) => change('crmName', e.target.value)}
              placeholder={c.name ?? 'Nombre del cliente'}
            />
          </label>
          <label>
            Estado comercial
            <select
              aria-label="Estado comercial"
              value={form.salesStage}
              onChange={(e) => change('salesStage', e.target.value as SalesStage)}
            >
              {Object.entries(salesStages).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Correo electrónico
            <input
              type="email"
              maxLength={254}
              value={form.email}
              onChange={(e) => change('email', e.target.value)}
            />
          </label>
          <label>
            Empresa
            <input
              maxLength={160}
              value={form.company}
              onChange={(e) => change('company', e.target.value)}
            />
          </label>
          <label>
            Responsable comercial
            <select
              aria-label="Responsable comercial"
              value={form.ownerUserId}
              onChange={(e) => change('ownerUserId', e.target.value)}
            >
              <option
                value=""
                disabled={
                  !detail.canAssign && Boolean(c.ownerUserId && c.ownerUserId !== detail.userId)
                }
              >
                Sin asignar
              </option>
              {detail.members
                .filter(
                  (m) =>
                    detail.canAssign || m.user.id === detail.userId || m.user.id === c.ownerUserId,
                )
                .map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {m.user.name ?? 'Integrante'}
                  </option>
                ))}
              {c.ownerUserId && !detail.members.some((m) => m.user.id === c.ownerUserId) && (
                <option value={c.ownerUserId}>Responsable anterior (sin acceso)</option>
              )}
            </select>
          </label>
          <label>
            Etiquetas
            <input
              aria-label="Etiquetas"
              maxLength={502}
              value={form.tags}
              onChange={(e) => change('tags', e.target.value)}
              placeholder="Ej.: Mayorista, Consulta de precios"
            />
            <small>Separadas por comas. Hasta 12 etiquetas de 40 caracteres.</small>
          </label>
        </div>
        <p className="crm-hint">
          El estado y el responsable comerciales no cierran el chat ni pausan el flujo.
        </p>
        <label>
          Observaciones
          <textarea
            aria-label="Observaciones"
            rows={4}
            maxLength={4000}
            value={form.profileNotes}
            onChange={(e) => change('profileNotes', e.target.value)}
          />
          <small>{form.profileNotes.length} / 4000</small>
        </label>
        <details className="crm-answers">
          <summary>Respuestas del recorrido actual ({detail.answers.length})</summary>
          <p>
            Revisá cada dato antes de incorporarlo. Se guardará al presionar Guardar ficha. Un nuevo
            recorrido puede cambiar las respuestas de esta lista.
          </p>
          {detail.answers.length === 0 ? (
            <p>Este contacto todavía no tiene respuestas guardadas por un flujo.</p>
          ) : (
            detail.answers.map((a) => (
              <div className="crm-answer" key={a.identifier}>
                <strong>{a.label}</strong>
                <span>{a.value}</span>
                <label>
                  <span className="sr-only">Usar {a.label} en</span>
                  <select
                    aria-label={`Usar ${a.label} en`}
                    defaultValue=""
                    onChange={(event) => {
                      const target = event.target.value;
                      event.target.value = '';
                      if (!target) return;
                      const max =
                        target === 'crmName'
                          ? 120
                          : target === 'company'
                            ? 160
                            : target === 'email'
                              ? 254
                              : 4000;
                      const value =
                        target === 'profileNotes'
                          ? [form.profileNotes, `${a.label}: ${a.value}`].filter(Boolean).join('\n')
                          : a.value;
                      if (value.length > max) {
                        setError('El dato excede el límite del campo. Editalo antes de guardar.');
                        return;
                      }
                      if (
                        target !== 'profileNotes' &&
                        form[target as 'crmName' | 'email' | 'company'] &&
                        !window.confirm(
                          'Este campo ya tiene un valor. ¿Reemplazarlo con la respuesta?',
                        )
                      )
                        return;
                      change(target as 'crmName' | 'email' | 'company' | 'profileNotes', value);
                    }}
                  >
                    <option value="">Usar en…</option>
                    <option value="crmName">Nombre</option>
                    <option value="email">Correo</option>
                    <option value="company">Empresa</option>
                    <option value="profileNotes">Observaciones</option>
                  </select>
                </label>
              </div>
            ))
          )}
        </details>
        {error && (
          <div role="alert" className="form-error">
            <p>{error}</p>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                if (
                  dirty &&
                  !window.confirm(
                    'Recargar reemplaza tus campos sin guardar por la última ficha guardada. ¿Continuar?',
                  )
                )
                  return;
                setBusy(true);
                try {
                  const result = await whatsappRequest<ContactDetail>(
                    `/api/workspaces/${tenantId}/contacts/${c.id}`,
                  );
                  setDetail(result);
                  setForm(fields(result));
                  setDirty(false);
                  onDirty(false);
                  setError('');
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'No pudimos recargar.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Recargar ficha
            </Button>
          </div>
        )}
        <div className="crm-save">
          <span role="status">{notice || (dirty ? 'Cambios sin guardar' : '')}</span>
          <Button disabled={busy || !dirty} type="submit">
            {busy ? 'Guardando…' : 'Guardar ficha'}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
