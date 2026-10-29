'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Logo />
        <nav aria-label="Navegación principal" className="desktop-nav">
          <Link href="#beneficios">Por qué MONZO</Link>
          <Link href="#como-funciona">Cómo funciona</Link>
          <Link href="#funcionalidades">Funcionalidades</Link>
        </nav>
        <div className="header-actions">
          <Link className="quiet-link desktop-nav" href="/dashboard">
            Explorar demo
          </Link>
          <Button asChild>
            <Link href="#conocer">
              Conocer MONZO <ArrowUpRight size={16} />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="mobile-menu-button"
            aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={open}
            aria-controls="site-mobile-nav"
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </div>
      {open && (
        <nav
          id="site-mobile-nav"
          aria-label="Navegación móvil"
          className="mobile-nav"
          onClick={() => setOpen(false)}
        >
          <Link href="#beneficios">Por qué MONZO</Link>
          <Link href="#como-funciona">Cómo funciona</Link>
          <Link href="#funcionalidades">Funcionalidades</Link>
          <Link href="/dashboard">Explorar demo</Link>
        </nav>
      )}
    </header>
  );
}
