import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleDashed,
  MessagesSquare,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Mascot } from '@/components/brand/mascot';
import { Button } from '@/components/ui/button';
export default function Dashboard() {
  return (
    <>
      <div className="dashboard-page-title">
        <div>
          <p className="eyebrow">TU PRÓXIMO GRAN ALIADO</p>
          <h1>
            Hola, esto es MONZO<span className="turquoise">.</span>
          </h1>
          <p>Un primer vistazo al lugar donde tus conversaciones van a crecer.</p>
        </div>
        <span className="small-badge">Vista de demostración</span>
      </div>
      <section className="dashboard-welcome">
        <div>
          <span className="availability">
            <Sparkles size={15} /> Un espacio lleno de posibilidades
          </span>
          <h2>
            Tu negocio, conectado.
            <br />
            Tu equipo, acompañado.
          </h2>
          <p>
            Estamos preparando una forma más simple de atender,
            <br className="desktop-break" /> automatizar y construir relaciones con tus clientes.
          </p>
          <Button asChild>
            <Link href="/dashboard/agentes-ia">
              Descubrir lo que viene <ArrowRight size={17} />
            </Link>
          </Button>
        </div>
        <Mascot reaction="support" size={300} priority />
      </section>
      <div className="dashboard-section-title">
        <h2>Todo empieza con una conexión</h2>
        <span>Disponibles en próximas fases</span>
      </div>
      <div className="dashboard-quick-grid">
        {[
          {
            icon: MessagesSquare,
            title: 'Conversaciones',
            text: 'Toda tu atención, en un mismo lugar.',
            href: 'conversaciones',
          },
          {
            icon: Sparkles,
            title: 'Agentes IA',
            text: 'Inteligencia que entiende tu negocio.',
            href: 'agentes-ia',
          },
          {
            icon: ShieldCheck,
            title: 'Equipo y acceso',
            text: 'Personas conectadas, con control.',
            href: 'equipo',
          },
        ].map(({ icon: Icon, title, text, href }) => (
          <Link key={title} href={`/dashboard/${href}`} className="dashboard-quick-card">
            <div>
              <span className="icon-tile">
                <Icon size={23} />
              </span>
              <ArrowUpRight size={18} />
            </div>
            <h3>{title}</h3>
            <p>{text}</p>
            <span className="small-badge">Próximamente</span>
          </Link>
        ))}
      </div>
      <div className="dashboard-lower">
        <section className="phase-card">
          <p className="eyebrow">PASO A PASO, CON PROPÓSITO</p>
          <h2>Así va tomando forma MONZO</h2>
          <div className="phase-row">
            <span className="phase-check">
              <Check size={16} />
            </span>
            <div>
              <strong>Fase 1 · Fundación visual y técnica</strong>
              <p>Landing, navegación y estructura del producto.</p>
            </div>
            <span className="small-badge">Estás acá</span>
          </div>
          <div className="phase-row">
            <CircleDashed size={23} />
            <div>
              <strong>Fase 2 · Autenticación y multiempresa</strong>
              <p>Identidad, membresías y aislamiento de datos.</p>
            </div>
          </div>
        </section>
        <section className="honesty-card">
          <ShieldCheck size={26} />
          <h3>La confianza empieza por la claridad.</h3>
          <p>
            No mostramos métricas inventadas. Cuando conectes tu negocio en una próxima fase, este
            espacio reflejará tu actividad real.
          </p>
          <Link href="/">
            Conocer la visión <ArrowRight size={16} />
          </Link>
        </section>
      </div>
    </>
  );
}
