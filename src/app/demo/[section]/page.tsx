import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Check, LockKeyhole } from 'lucide-react';
import { getSection, platformSections } from '@/modules/platform/navigation';
import { Mascot } from '@/components/brand/mascot';
import { Button } from '@/components/ui/button';
export const dynamicParams = false;
export function generateStaticParams() {
  return platformSections.map((s) => ({ section: s.slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string }>;
}): Promise<Metadata> {
  const { section } = await params;
  return { title: getSection(section)?.label ?? 'Página no encontrada' };
}
export default async function Section({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const item = getSection(section);
  if (!item) notFound();
  return (
    <>
      <div className="dashboard-page-title">
        <div>
          <p className="eyebrow">EL PRODUCTO QUE VIENE</p>
          <h1>
            {item.label}
            <span className="turquoise">.</span>
          </h1>
          <p>{item.description}</p>
        </div>
      </div>
      <section className="coming-soon">
        <Mascot
          reaction={
            section === 'agentes-ia' ? 'idea' : section === 'analiticas' ? 'growth' : 'working'
          }
          size={230}
          priority
        />
        <span className="availability">
          <span className="status-dot" /> Próximamente
        </span>
        <h2>
          Las buenas conexiones
          <br />
          se construyen paso a paso.
        </h2>
        <p>
          Esta sección forma parte de la visión de MONZO.
          <br />
          Todavía no procesa datos ni permite operaciones reales.
        </p>
        <div className="upcoming-note">
          <LockKeyhole size={19} />
          <span>
            Primero vamos a preparar el acceso seguro y los espacios independientes de cada empresa
            en la Fase 2.
          </span>
        </div>
        <Button asChild variant="outline">
          <Link href="/demo">
            <ArrowLeft size={16} />
            Volver al inicio
          </Link>
        </Button>
        <span className="coming-soon-foot">
          <Check size={14} /> Navegación disponible · Funciones en desarrollo
        </span>
      </section>
    </>
  );
}
