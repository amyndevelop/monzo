import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Check,
  CircleCheck,
  GitBranch,
  Layers3,
  MessageCircle,
  MessagesSquare,
  MoveUpRight,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react';
import { SiteHeader } from '@/components/site/header';
import { Logo } from '@/components/brand/logo';
import { Mascot } from '@/components/brand/mascot';
import { Button } from '@/components/ui/button';
const benefits = [
  {
    icon: Zap,
    title: 'Respondé más rápido.',
    text: 'Menos espera. Más conversaciones que avanzan.',
  },
  {
    icon: Sparkles,
    title: 'Automatizá conversaciones.',
    text: 'Dale espacio a tu equipo para lo que más importa.',
  },
  {
    icon: MessagesSquare,
    title: 'Centralizá la atención.',
    text: 'Un lugar para conectar clientes, equipo y contexto.',
  },
  {
    icon: MoveUpRight,
    title: 'Aprovechá oportunidades.',
    text: 'Acompañá cada consulta hasta su próximo paso.',
  },
  {
    icon: ShieldCheck,
    title: 'Mantené el control humano.',
    text: 'Inteligencia artificial con tu equipo al mando.',
  },
];
const features = [
  {
    icon: MessageCircle,
    title: 'Una bandeja. Todo el contexto.',
    text: 'WhatsApp, historial, notas y asignaciones para una atención conectada.',
    tag: 'Conversaciones',
  },
  {
    icon: Sparkles,
    title: 'Un asistente que conoce tu negocio.',
    text: 'Agentes con tu personalidad y una base de conocimientos propia.',
    tag: 'Inteligencia artificial',
  },
  {
    icon: GitBranch,
    title: 'Menos tareas. Más posibilidades.',
    text: 'Flujos para responder, dar seguimiento y conectar tus herramientas.',
    tag: 'Automatizaciones',
  },
  {
    icon: Users,
    title: 'Cada cliente, más cerca.',
    text: 'Contactos, etiquetas y seguimiento para construir mejores relaciones.',
    tag: 'CRM y equipo',
  },
];
export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="hero container">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="status-dot" /> MÁS CONEXIÓN. MÁS POSIBILIDADES.
            </div>
            <h1>
              Tus conversaciones
              <br />
              trabajan{' '}
              <span className="accent-word">
                por vos
                <svg viewBox="0 0 340 20" aria-hidden="true">
                  <path d="M4 13 Q150 -3 334 10" />
                </svg>
                .
              </span>
            </h1>
            <p className="hero-description">
              MONZO centraliza la atención de tus clientes, automatiza conversaciones con
              inteligencia artificial y ayuda a tu negocio a crecer.
            </p>
            <div className="hero-buttons">
              <Button asChild size="lg">
                <Link href="#conocer">
                  Conocer MONZO <ArrowUpRight size={18} />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="#funcionalidades">
                  Ver funcionalidades <ArrowRight size={17} />
                </Link>
              </Button>
            </div>
            <p className="hero-footnote">
              <ShieldCheck size={15} /> Pensado para tu negocio. Diseñado para las personas.
            </p>
          </div>
          <div className="hero-visual" aria-label="Ilustración conceptual de MONZO">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <span className="visual-star star-one">✦</span>
            <span className="visual-star star-two">✦</span>
            <div className="floating-card visual-message">
              <span className="icon-tile">
                <MessageCircle size={21} />
              </span>
              <div>
                <strong>Cada conversación cuenta</strong>
                <span>Conectá con lo que importa.</span>
              </div>
              <span className="mini-dot" />
            </div>
            <div className="mascot-halo" />
            <Mascot reaction="welcome" size={430} priority className="hero-mascot" />
            <div className="floating-card visual-ai">
              <span className="icon-tile">
                <Sparkles size={20} />
              </span>
              <div>
                <strong>Un gran aliado para tu equipo</strong>
                <span>Inteligencia con un toque humano.</span>
              </div>
            </div>
            <div className="visual-label">
              <span className="status-dot" /> Hola, soy MONZO <span aria-hidden="true">✧</span>
            </div>
            <span className="concept-label">Ilustración del producto en desarrollo</span>
          </div>
        </section>
        <div className="promise-strip">
          <div className="container promise-inner">
            <p>
              Una nueva forma de <strong>conversar y crecer.</strong>
            </p>
            <span>
              <MessagesSquare size={18} /> Atención conectada
            </span>
            <span>
              <Sparkles size={18} /> IA con propósito
            </span>
            <span>
              <ShieldCheck size={18} /> Control humano
            </span>
          </div>
        </div>
        <section className="section container" id="beneficios">
          <div className="section-heading">
            <div>
              <p className="eyebrow">MENOS FRICCIÓN, MÁS CONEXIÓN</p>
              <h2>
                Tu atención puede
                <br />
                llegar más lejos.
              </h2>
            </div>
            <p>
              Tu negocio crece cuando cada conversación
              <br className="desktop-break" /> tiene la atención que merece. Ahí entra MONZO.
            </p>
          </div>
          <div className="benefits-grid">
            {benefits.map(({ icon: Icon, title, text }, i) => (
              <article className="benefit" key={title}>
                <span className="benefit-number">0{i + 1}</span>
                <span className="benefit-icon">
                  <Icon size={23} />
                </span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="how-section" id="como-funciona">
          <div className="container how-inner">
            <div className="how-intro">
              <p className="eyebrow">ASÍ LO ESTAMOS CONSTRUYENDO</p>
              <h2>
                Simple desde
                <br />
                el primer hola.
              </h2>
              <p>
                La tecnología se ocupa de la complejidad.
                <br />
                Vos, de tu negocio.
              </p>
              <span className="availability">
                <span className="status-dot" /> Flujo previsto · Próximamente
              </span>
            </div>
            <div className="steps">
              {[
                {
                  title: 'Conectás tu negocio.',
                  text: 'Un espacio propio para tu empresa, tu equipo y tus canales.',
                },
                {
                  title: 'Configurás tu asistente.',
                  text: 'Tu forma de hablar. Tu conocimiento. Tus reglas.',
                },
                {
                  title: 'MONZO comienza a ayudarte.',
                  text: 'Atención más ágil, con personas e inteligencia trabajando juntas.',
                },
              ].map((step, i) => (
                <article key={step.title} className="step">
                  <span className="step-index">0{i + 1}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.text}</p>
                  </div>
                  {i === 2 ? (
                    <CircleCheck className="step-icon" size={23} />
                  ) : (
                    <ArrowUpRight className="step-icon" size={23} />
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="section container" id="funcionalidades">
          <div className="section-heading">
            <div>
              <p className="eyebrow">UN ECOSISTEMA DE POSIBILIDADES</p>
              <h2>
                Todo conectado.
                <br />
                Todo con sentido.
              </h2>
            </div>
            <div>
              <p>
                Una plataforma pensada para acompañarte
                <br />
                en cada etapa de tu crecimiento.
              </p>
              <span className="availability">
                <span className="status-dot" /> En desarrollo · No disponible todavía
              </span>
            </div>
          </div>
          <div className="feature-grid">
            {features.map(({ icon: Icon, title, text, tag }, i) => (
              <article key={tag} className={`feature-card feature-${i}`}>
                <div className="feature-top">
                  <span className="icon-tile">
                    <Icon size={24} />
                  </span>
                  <span className="small-badge">Próximamente</span>
                </div>
                <p className="feature-category">{tag}</p>
                <h3>{title}</h3>
                <p>{text}</p>
                <span className="feature-decoration" aria-hidden="true">
                  {i === 0 ? (
                    <MessagesSquare />
                  ) : i === 1 ? (
                    <AudioLines />
                  ) : i === 2 ? (
                    <GitBranch />
                  ) : (
                    <Layers3 />
                  )}
                </span>
              </article>
            ))}
          </div>
          <div className="demo-link">
            <span>
              <Check size={18} /> Ya podés recorrer la base visual del producto.
            </span>
            <Link href="/demo">
              Explorar el dashboard de demostración <ArrowRight size={17} />
            </Link>
          </div>
        </section>
        <section className="container closing-wrap" id="conocer">
          <div className="closing">
            <div>
              <p className="eyebrow">EL PRÓXIMO HOLA EMPIEZA ACÁ</p>
              <h2>
                Más tiempo para crecer.
                <br />
                MONZO te acompaña.
              </h2>
              <p>
                Estamos dando los primeros pasos. Conocé la visión
                <br className="desktop-break" /> y explorá lo que estamos construyendo.
              </p>
              <Button asChild size="lg">
                <Link href="/demo">
                  Conocer el producto <ArrowUpRight size={18} />
                </Link>
              </Button>
              <span className="closing-note">
                Demo visual pública · Sin registro ni conexión de datos
              </span>
            </div>
            <Mascot reaction="wink" size={330} className="closing-mascot" decorative />
          </div>
        </section>
      </main>
      <footer className="site-footer container">
        <div className="footer-top">
          <div>
            <Logo />
            <p>
              Conversaciones que conectan.
              <br />
              Tecnología que acompaña.
            </p>
          </div>
          <nav aria-label="Pie de página">
            <Link href="#beneficios">Por qué MONZO</Link>
            <Link href="#funcionalidades">Funcionalidades</Link>
            <Link href="/demo">
              Explorar demo <ArrowUpRight size={14} />
            </Link>
          </nav>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} MONZO. Todos los derechos reservados.</span>
          <span>
            Hecho para conectar <span className="turquoise">✦</span>
          </span>
          <span>Producto en desarrollo · Fase 1</span>
        </div>
      </footer>
    </>
  );
}
