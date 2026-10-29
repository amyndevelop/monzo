'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowUpRight,
  ChartNoAxesCombined,
  ChevronDown,
  House,
  Menu,
  MessagesSquare,
  Settings2,
  Sparkles,
  Users,
  Workflow,
  X,
  ContactRound,
  Building2,
  PanelLeftClose,
  Info,
} from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { platformSections } from '@/modules/platform/navigation';
const icons = {
  messages: MessagesSquare,
  contacts: ContactRound,
  sparkles: Sparkles,
  workflow: Workflow,
  chart: ChartNoAxesCombined,
  team: Users,
  settings: Settings2,
};
export function DashboardShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [companyOpen, setCompanyOpen] = useState(false);
  const title = platformSections.find((s) => path === `/demo/${s.slug}`)?.label ?? 'Inicio';
  return (
    <div className="dashboard-layout">
      {open && (
        <button
          className="sidebar-backdrop"
          aria-label="Cerrar navegación"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className={`dashboard-sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <Logo />
          <Button
            variant="ghost"
            size="icon"
            className="sidebar-close"
            aria-label="Cerrar navegación"
            onClick={() => setOpen(false)}
          >
            <PanelLeftClose size={20} />
          </Button>
        </div>
        <div className="workspace-area">
          <button
            className="workspace-selector"
            aria-expanded={companyOpen}
            aria-controls="workspace-note"
            onClick={() => setCompanyOpen(!companyOpen)}
          >
            <span className="workspace-icon">
              <Building2 size={19} />
            </span>
            <span>
              <strong>Espacio de muestra</strong>
              <small>Sin empresa conectada</small>
            </span>
            <ChevronDown size={16} />
          </button>
          {companyOpen && (
            <div className="workspace-note" id="workspace-note">
              El selector de empresa estará disponible con la autenticación y las membresías en Fase
              2.
            </div>
          )}
        </div>
        <p className="nav-label">TU ESPACIO DE TRABAJO</p>
        <nav aria-label="Navegación del dashboard">
          <Link
            className={`dashboard-nav-item ${path === '/demo' ? 'active' : ''}`}
            href="/demo"
            aria-current={path === '/demo' ? 'page' : undefined}
            onClick={() => setOpen(false)}
          >
            <House size={19} />
            Inicio
          </Link>
          {platformSections.map((s) => {
            const Icon = icons[s.icon];
            const active = path === `/demo/${s.slug}`;
            return (
              <Link
                key={s.slug}
                className={`dashboard-nav-item ${active ? 'active' : ''}`}
                href={`/demo/${s.slug}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => setOpen(false)}
              >
                <Icon size={19} />
                {s.label}
                <span className="nav-soon" aria-label="Próximamente" />
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="build-note">
            <Sparkles size={21} />
            <strong>
              Estamos construyendo
              <br />
              algo que conecta.
            </strong>
            <p>Este es el primer paso de MONZO.</p>
          </div>
          <Link href="/" className="back-to-site">
            Volver al sitio <ArrowUpRight size={16} />
          </Link>
        </div>
      </aside>
      <div className="dashboard-main">
        <header className="dashboard-header">
          <div className="dashboard-heading">
            <Button
              className="sidebar-toggle"
              variant="ghost"
              size="icon"
              aria-label="Abrir navegación"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              {open ? <X /> : <Menu />}
            </Button>
            <span>Mi espacio</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{title}</strong>
          </div>
          <span className="demo-pill">
            <span className="status-dot" /> Demo pública
          </span>
        </header>
        <div className="demo-banner">
          <Info size={17} />
          <p>
            Estás explorando una <strong>demostración visual</strong>. No hay una sesión real ni
            datos de empresas conectados.
          </p>
        </div>
        <main id="main" className="dashboard-content">
          {children}
        </main>
        <footer className="dashboard-footer">
          MONZO Cloud <span>Fase 1 · Base visual del producto</span>
        </footer>
      </div>
    </div>
  );
}
