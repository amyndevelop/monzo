'use client';
import { useState, useRef, useEffect, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, PanelLeftClose, House, ArrowUpRight, ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { SignOut } from '@/components/auth/sign-out';
import { WorkspaceSwitcher, type WorkspaceOption } from './workspace-picker';
import { platformSections } from '@/modules/platform/navigation';
import { InboxNavigationContext } from './inbox-navigation';
const mobileQuery = '(max-width: 900px)';
function watchViewport(onChange: () => void) {
  const media = window.matchMedia(mobileQuery);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
export function PrivateShell({
  children,
  user,
  memberships,
  tenantId,
  role,
}: {
  children: React.ReactNode;
  user: { name: string };
  memberships: WorkspaceOption[];
  tenantId: string;
  role: string;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const mobile = useSyncExternalStore(
    watchViewport,
    () => window.matchMedia(mobileQuery).matches,
    () => false,
  );
  const inbox = path === '/dashboard/conversaciones';
  const visible = mobile ? open : !inbox || !collapsed;
  const sidebar = useRef<HTMLElement>(null);
  function closeNavigation() {
    if (mobile) setOpen(false);
    else setCollapsed(true);
    requestAnimationFrame(() => {
      [...document.querySelectorAll<HTMLButtonElement>('[data-navigation-toggle]')]
        .find((button) => button.getClientRects().length)
        ?.focus();
    });
  }
  useEffect(() => {
    if (mobile && open)
      sidebar.current?.querySelector<HTMLButtonElement>('.sidebar-close')?.focus();
  }, [mobile, open]);
  return (
    <InboxNavigationContext.Provider
      value={{
        visible,
        mobile,
        toggle: () => (mobile ? setOpen(!open) : setCollapsed(!collapsed)),
      }}
    >
      <div
        className={`dashboard-layout ${inbox ? 'inbox-layout' : ''} ${inbox && collapsed ? 'sidebar-collapsed' : ''}`}
      >
        {open && (
          <button className="sidebar-backdrop" aria-label="Cerrar menú" onClick={closeNavigation} />
        )}
        <aside
          ref={sidebar}
          id="private-navigation"
          className={`dashboard-sidebar ${open ? 'sidebar-open' : ''}`}
          inert={!visible}
          aria-hidden={!visible}
          role={mobile ? 'dialog' : undefined}
          aria-modal={mobile && open ? true : undefined}
          aria-label="Menú principal"
          onKeyDown={(event) => {
            if (!mobile || !open) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              closeNavigation();
            }
            if (event.key !== 'Tab') return;
            const controls = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex="0"]',
              ),
            ].filter((element) => element.getClientRects().length);
            const first = controls[0];
            const last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }}
        >
          <div className="sidebar-brand">
            <Logo />
            <Button
              className="sidebar-close"
              variant="ghost"
              size="icon"
              aria-label={mobile ? 'Cerrar navegación' : 'Ocultar menú'}
              title={mobile ? 'Cerrar navegación' : 'Ocultar menú'}
              onClick={closeNavigation}
            >
              <PanelLeftClose />
            </Button>
          </div>
          <div className="workspace-area">
            <WorkspaceSwitcher memberships={memberships} activeId={tenantId} />
          </div>
          <p className="nav-label">TU ESPACIO DE TRABAJO</p>
          <nav aria-label="Navegación privada">
            <Link
              className={`dashboard-nav-item ${path === '/dashboard' ? 'active' : ''}`}
              href="/dashboard"
              onClick={() => setOpen(false)}
            >
              <House size={17} />
              Inicio
            </Link>
            {platformSections.map((section) => (
              <Link
                key={section.slug}
                href={`/dashboard/${section.slug}`}
                onClick={() => setOpen(false)}
                className={`dashboard-nav-item ${path === `/dashboard/${section.slug}` ? 'active' : ''}`}
                aria-current={path === `/dashboard/${section.slug}` ? 'page' : undefined}
              >
                {section.label}
                {![
                  'equipo',
                  'configuracion',
                  'canales',
                  'contactos',
                  'conversaciones',
                  'agentes-ia',
                  'automatizaciones',
                  'analiticas',
                ].includes(section.slug) && <span className="nav-soon" aria-label="Próximamente" />}
              </Link>
            ))}
          </nav>
          <div className="sidebar-bottom">
            {!inbox && (
              <div className="build-note">
                <ShieldCheck size={22} />
                <strong>
                  {role === 'OWNER'
                    ? 'Propietario'
                    : role === 'ADMIN'
                      ? 'Administrador'
                      : 'Miembro'}
                </strong>
                <p>El acceso se verifica en cada operación.</p>
              </div>
            )}
            {inbox && (
              <div className="sidebar-account">
                <span className="sidebar-account-avatar" aria-hidden="true">
                  {user.name.slice(0, 1)}
                </span>
                <span>
                  <strong>{user.name}</strong>
                  <small>
                    {role === 'OWNER'
                      ? 'Propietario'
                      : role === 'ADMIN'
                        ? 'Administrador'
                        : 'Miembro'}
                  </small>
                </span>
              </div>
            )}
            {inbox && (
              <div className="sidebar-sign-out">
                <SignOut />
              </div>
            )}
            <Link href="/empresas" className="back-to-site">
              Mis empresas <ArrowUpRight size={15} />
            </Link>
            <Link href="/" className="back-to-site">
              Volver al sitio <ArrowUpRight size={15} />
            </Link>
          </div>
        </aside>
        <div className="dashboard-main" inert={mobile && open}>
          {!inbox && (
            <header className="dashboard-header">
              <div className="dashboard-heading">
                <Button
                  className="sidebar-toggle"
                  variant="ghost"
                  size="icon"
                  aria-label="Abrir navegación"
                  aria-expanded={open}
                  aria-controls="private-navigation"
                  data-navigation-toggle
                  onClick={() => setOpen(true)}
                >
                  <Menu />
                </Button>
                <strong>{user.name}</strong>
                <span className="session-indicator">
                  <ShieldCheck size={14} /> Sesión verificada
                </span>
              </div>
              <SignOut />
            </header>
          )}
          <main id="main" className="dashboard-content">
            {children}
          </main>
          {!inbox && (
            <footer className="dashboard-footer">
              MONZO Cloud<span>Tu empresa, tu espacio</span>
            </footer>
          )}
        </div>
      </div>
    </InboxNavigationContext.Provider>
  );
}
