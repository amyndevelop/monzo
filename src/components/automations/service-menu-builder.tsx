'use client';
import { useEffect, useRef, useState } from 'react';
import { FileSpreadsheet, Upload, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  createServiceMenu,
  readServicePrices,
  type ServicePrice,
} from '@/modules/automations/service-menu';
import type { FlowGraph } from '@/modules/automations/definition';

export function ServiceMenuBuilder({
  replaceExisting,
  opening,
  onCreate,
  onCancel,
}: {
  replaceExisting: boolean;
  opening: number;
  onCreate: (graph: FlowGraph) => void;
  onCancel: () => void;
}) {
  const [prices, setPrices] = useState<ServicePrice[]>([]),
    [filename, setFilename] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  const [welcome, setWelcome] = useState(
      '¡Hola! Gracias por escribirnos. Elegí qué servicios querés consultar.',
    ),
    [replacementOpening, setReplacementOpening] = useState<number | null>(null);
  const replace = replacementOpening === opening;
  const input = useRef<HTMLInputElement>(null),
    epoch = useRef(0);
  const errorBox = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) {
      errorBox.current?.scrollIntoView({ block: 'nearest' });
      errorBox.current?.focus({ preventScroll: true });
    }
  }, [error]);
  const categories = [...new Set(prices.map((p) => p.category))];
  const groups = [...new Set(prices.map((p) => JSON.stringify([p.category, p.service])))];
  return (
    <div className="service-menu-builder">
      <div className="service-menu-body">
        <p>
          Convertí tu lista de precios en un recorrido: categoría → servicio → paquetes y precios →
          consulta con el equipo.
        </p>
        <div className="service-menu-upload">
          <FileSpreadsheet size={27} aria-hidden="true" />
          <strong>Tu lista de servicios</strong>
          <p>
            CSV con cinco columnas: categoría, servicio, cantidad, precio y moneda. Hasta 250
            paquetes y 128 KB.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => input.current?.click()}
          >
            <Upload size={16} />
            {loading ? 'Leyendo lista…' : 'Elegir archivo CSV'}
          </Button>
          <input
            ref={input}
            type="file"
            tabIndex={-1}
            accept=".csv,text/csv"
            className="sr-only"
            aria-label="Lista de servicios y precios CSV"
            onChange={async (event) => {
              const file = event.target.files?.[0],
                request = ++epoch.current;
              if (!file) return;
              setError('');
              setPrices([]);
              setFilename(file.name);
              setLoading(true);
              setReplacementOpening(null);
              try {
                if (file.size > 131072) throw new Error('La lista debe ocupar hasta 128 KB.');
                const rows = readServicePrices(await file.text());
                createServiceMenu(rows);
                if (request === epoch.current) setPrices(rows);
              } catch (e) {
                if (request === epoch.current)
                  setError(e instanceof Error ? e.message : 'No pudimos leer la lista.');
              } finally {
                if (request === epoch.current) setLoading(false);
              }
            }}
          />
          {filename && <small>{filename}</small>}
        </div>
        <details className="service-menu-format">
          <summary>Cómo preparar el archivo</summary>
          <p>Usá estos encabezados, separados por punto y coma:</p>
          <code>categoria;servicio;cantidad;precio;moneda</code>
          <p>
            La cantidad se escribe sin puntos. El precio es el total del paquete, sin símbolo ni
            separadores de miles. Moneda: ARS, USD u otra de tres letras. No mezcles monedas en el
            mismo menú.
          </p>
        </details>
        <label className="service-menu-welcome">
          Mensaje de bienvenida
          <input value={welcome} maxLength={600} onChange={(e) => setWelcome(e.target.value)} />
        </label>
        {error && (
          <p className="form-error" role="alert" ref={errorBox} tabIndex={-1}>
            {error}
          </p>
        )}
        {prices.length > 0 && (
          <>
            <p className="service-menu-count" role="status">
              <CheckCircle2 size={17} />
              {prices.length} paquetes · {groups.length} servicios · {categories.length} categorías
            </p>
            <p>
              Revisá los importes. Cada servicio mostrará todos sus paquetes y una opción para
              consultar la compra con un asesor.
            </p>
            <div className="service-menu-preview">
              {categories.map((category) => (
                <details key={category}>
                  <summary>
                    {category}{' '}
                    <span>{prices.filter((p) => p.category === category).length} paquetes</span>
                  </summary>
                  {[
                    ...new Set(prices.filter((p) => p.category === category).map((p) => p.service)),
                  ].map((service) => (
                    <section key={service}>
                      <h3>{service}</h3>
                      <table>
                        <caption className="sr-only">
                          {category} · {service}
                        </caption>
                        <thead>
                          <tr>
                            <th>Cantidad</th>
                            <th>Precio del paquete</th>
                          </tr>
                        </thead>
                        <tbody>
                          {prices
                            .filter((p) => p.category === category && p.service === service)
                            .map((p) => (
                              <tr key={p.quantity}>
                                <td>{p.quantity.toLocaleString('es-AR')}</td>
                                <td>
                                  {new Intl.NumberFormat('es-AR', {
                                    style: 'currency',
                                    currency: p.currency,
                                  }).format(Number(p.amount))}{' '}
                                  {p.currency}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </section>
                  ))}
                </details>
              ))}
            </div>
            <p className="service-menu-note">
              Los precios quedan guardados en los mensajes de este flujo. Para actualizarlos,
              importá la lista corregida y volvé a publicar. No se crean pedidos ni se confirman
              pagos automáticamente.
            </p>
            {replaceExisting && (
              <label className="service-menu-replace">
                <input
                  type="checkbox"
                  checked={replace}
                  onChange={(e) => setReplacementOpening(e.target.checked ? opening : null)}
                />
                <span>
                  Reemplazar el borrador actual. La versión publicada seguirá igual hasta que vuelva
                  a publicarlo.
                </span>
              </label>
            )}
          </>
        )}
      </div>
      <footer className="service-menu-footer">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          type="button"
          disabled={loading || !prices.length || (replaceExisting && !replace)}
          onClick={() => {
            try {
              const graph = createServiceMenu(prices, welcome);
              setError('');
              onCreate(graph);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Revisá la lista antes de continuar.');
            }
          }}
        >
          Preparar borrador
        </Button>
        <small>Después podrás probarlo, guardarlo y publicarlo.</small>
      </footer>
    </div>
  );
}
