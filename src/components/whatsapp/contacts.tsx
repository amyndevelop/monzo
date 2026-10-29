'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ContactRound, Search, ArrowUpRight } from 'lucide-react';
import { whatsappRequest } from './http';
import type { ContactItem } from '@/modules/whatsapp/types';
export function Contacts({ tenantId }: { tenantId: string }) {
  const [items, setItems] = useState<ContactItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void whatsappRequest<ContactItem[]>(
      `/api/workspaces/${tenantId}/contacts?q=${encodeURIComponent(query)}`,
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
      .catch((error) => {
        if (active)
          setError(error instanceof Error ? error.message : 'No pudimos cargar los contactos.');
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [tenantId, query]);
  return (
    <section className="contacts-panel">
      <label className="inbox-search">
        <Search size={17} />
        <span className="sr-only">Buscar contactos</span>
        <input
          maxLength={80}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por nombre o teléfono"
        />
      </label>
      <p className="contacts-help">
        Los contactos se crean al recibir mensajes de WhatsApp. Se muestran hasta 100 resultados.
      </p>
      {loading ? (
        <p role="status">Cargando contactos…</p>
      ) : items.length === 0 ? (
        <div className="channel-empty">
          <ContactRound size={30} />
          <h2>{query ? 'Sin coincidencias.' : 'Todavía no hay contactos.'}</h2>
          <p>Conectá WhatsApp y recibí tu primera conversación para comenzar.</p>
        </div>
      ) : (
        <div className="contact-grid">
          {items.map((contact) => (
            <article key={contact.id}>
              <span className="contact-avatar">{(contact.name ?? contact.waId).slice(0, 1)}</span>
              <h3>{contact.name ?? 'Sin nombre de perfil'}</h3>
              <p>+{contact.waId}</p>
              <small>Canal: {contact.account.displayPhone}</small>
              {contact.conversations[0] && (
                <Link
                  href={`/dashboard/conversaciones?conversation=${contact.conversations[0].id}`}
                >
                  Abrir conversación <ArrowUpRight size={15} />
                </Link>
              )}
            </article>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}
