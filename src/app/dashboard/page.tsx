import Link from 'next/link';
import { ArrowRight, Building2, Users, Settings2 } from 'lucide-react';
import { Mascot } from '@/components/brand/mascot';
import { Button } from '@/components/ui/button';
import { requireDashboardContext } from '@/modules/access/policy';
export default async function Dashboard() {
  const { tenant } = await requireDashboardContext();
  return (
    <>
      <div className="dashboard-page-title">
        <div>
          <p className="eyebrow">TU ESPACIO YA ESTÁ LISTO</p>
          <h1>
            {tenant.name}
            <span className="turquoise">.</span>
          </h1>
          <p>Tu cuenta está verificada y este espacio pertenece a tu empresa.</p>
        </div>
      </div>
      <section className="dashboard-welcome">
        <div>
          <span className="availability">
            <Building2 size={16} /> Un espacio independiente
          </span>
          <h2>
            Tu equipo tiene
            <br />
            un lugar para conectar.
          </h2>
          <p>
            Administrá las personas y preferencias de tu empresa.
            <br />
            Los canales, agentes y automatizaciones llegarán en próximas fases.
          </p>
          <Button asChild>
            <Link href="/dashboard/equipo">
              Ver mi equipo <ArrowRight size={17} />
            </Link>
          </Button>
        </div>
        <Mascot reaction="welcome" size={250} priority />
      </section>
      <div className="dashboard-quick-grid workspace-shortcuts">
        <Link href="/dashboard/equipo" className="dashboard-quick-card">
          <Users className="turquoise" />
          <h3>Equipo y permisos</h3>
          <p>Personas con acceso a esta empresa.</p>
        </Link>
        <Link href="/dashboard/configuracion" className="dashboard-quick-card">
          <Settings2 className="turquoise" />
          <h3>Preferencias de empresa</h3>
          <p>Nombre, idioma y zona horaria.</p>
        </Link>
        <Link href="/empresas" className="dashboard-quick-card">
          <Building2 className="turquoise" />
          <h3>Mis empresas</h3>
          <p>Cambiá de espacio o creá uno nuevo.</p>
        </Link>
      </div>
    </>
  );
}
