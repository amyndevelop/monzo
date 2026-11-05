'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ContactRound, Search, ArrowUpRight } from 'lucide-react';
import { whatsappRequest } from './http';
import { Button } from '@/components/ui/button';
import { ContactDrawer } from '@/components/contacts/contact-drawer';
import { salesStages, type ContactProfile } from '@/modules/contacts/types';
export function Contacts({ tenantId }: { tenantId: string }) {
  const [items, setItems] = useState<ContactProfile[]>([]);
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState('');
  const [owner, setOwner] = useState('');
  const [tag, setTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      void whatsappRequest<ContactProfile[]>(
        `/api/workspaces/${tenantId}/contacts?${new URLSearchParams({ q: query, stage, owner, tag })}`,
        'GET',
        undefined,
        controller.signal,
      )
        .then((data) => {
          if (active) {
            setItems(data);
            setLoading(false);
          }
        })
        .catch((e) => {
          if (active) {
            setError(e instanceof Error ? e.message : 'No pudimos cargar los contactos.');
            setLoading(false);
          }
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [tenantId, query, stage, owner, tag, refresh]);
  const filtered = Boolean(query || stage || owner || tag);
  return (
    <section className="contacts-panel crm-contacts">
      <div className="crm-filters">
        <label className="inbox-search">
          <Search size={17} />
          <span className="sr-only">Buscar contactos</span>
          <input
            maxLength={80}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nombre, teléfono, correo o empresa"
          />
        </label>
        <label>
          <span className="sr-only">Filtrar estado comercial</span>
          <select
            aria-label="Filtrar estado comercial"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
          >
            <option value="">Todos los estados</option>
            {Object.entries(salesStages).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Filtrar responsable</span>
          <select
            aria-label="Filtrar responsable"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          >
            <option value="">Todos los responsables</option>
            <option value="me">Mis contactos</option>
            <option value="unassigned">Sin asignar</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Filtrar etiqueta</span>
          <input
            aria-label="Filtrar etiqueta"
            maxLength={40}
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="Etiqueta exacta"
          />
        </label>
      </div>
      <div className="crm-list-status">
        <p>
          Contactos por número de WhatsApp · Hasta 100 resultados
          {!loading && !error ? ` · ${items.length} encontrados` : ''}
        </p>
        {filtered && (
          <Button
            variant="ghost"
            onClick={() => {
              setQuery('');
              setStage('');
              setOwner('');
              setTag('');
            }}
          >
            Limpiar filtros
          </Button>
        )}
      </div>
      {loading && items.length > 0 && <p role="status">Actualizando contactos…</p>}
      {error ? (
        <div role="alert" className="form-error">
          <p>{error}</p>
          <Button variant="outline" onClick={() => setRefresh((v) => v + 1)}>
            Reintentar
          </Button>
        </div>
      ) : loading && items.length === 0 ? (
        <p role="status">Cargando contactos…</p>
      ) : items.length === 0 ? (
        <div className="channel-empty">
          <ContactRound size={30} />
          <h2>{filtered ? 'Sin coincidencias.' : 'Todavía no hay contactos.'}</h2>
          <p>
            {filtered
              ? 'Probá cambiar los filtros.'
              : 'Los contactos se crean al recibir mensajes de WhatsApp.'}
          </p>
        </div>
      ) : (
        <div className="crm-list" aria-busy={loading}>
          {items.map((c) => (
            <article key={c.id} className="crm-contact-row">
              <button
                type="button"
                className="crm-open"
                onClick={() => setSelected(c.id)}
                aria-label={`Abrir ficha de ${c.crmName ?? c.name ?? c.waId}`}
              >
                <span className="contact-avatar">
                  {(c.crmName ?? c.name ?? c.waId).slice(0, 1)}
                </span>
                <span>
                  <strong>{c.crmName ?? c.name ?? 'Sin nombre'}</strong>
                  <small>
                    +{c.waId}
                    {c.company ? ` · ${c.company}` : ''}
                  </small>
                  <small>{c.account.displayPhone}</small>
                </span>
              </button>
              <div className="crm-row-meta">
                <span className={`crm-stage crm-stage-${c.salesStage.toLowerCase()}`}>
                  {salesStages[c.salesStage]}
                </span>
                <small>
                  {c.owner?.name ?? (c.ownerUserId ? 'Responsable anterior' : 'Sin responsable')}
                </small>
              </div>
              <div className="crm-tags">
                {c.tags.map((t) => (
                  <button
                    type="button"
                    key={t}
                    onClick={() => setTag(t)}
                    aria-label={`Filtrar etiqueta ${t}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="crm-row-actions">
                <Button variant="outline" onClick={() => setSelected(c.id)}>
                  Ver ficha
                </Button>
                {c.conversations[0] && (
                  <Link
                    href={`/dashboard/conversaciones?conversation=${c.conversations[0].id}`}
                    aria-label={`Abrir conversación de ${c.crmName ?? c.name ?? c.waId}`}
                  >
                    <ArrowUpRight size={17} />
                    <span>Chat</span>
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {selected && (
        <ContactDrawer
          key={`${tenantId}:${selected}`}
          tenantId={tenantId}
          contactId={selected}
          onClose={() => setSelected(null)}
          onSaved={() => setRefresh((v) => v + 1)}
        />
      )}
    </section>
  );
}
