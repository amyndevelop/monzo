'use client';
import { createContext, useContext } from 'react';
import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

export const InboxNavigationContext = createContext<{
  visible: boolean;
  mobile: boolean;
  toggle: () => void;
} | null>(null);
export function InboxNavigationToggle({ className = '' }: { className?: string }) {
  const navigation = useContext(InboxNavigationContext);
  if (!navigation) return null;
  const label = navigation.mobile
    ? navigation.visible
      ? 'Cerrar navegación'
      : 'Abrir navegación'
    : navigation.visible
      ? 'Ocultar menú'
      : 'Mostrar menú';
  const Icon = navigation.mobile ? Menu : navigation.visible ? PanelLeftClose : PanelLeftOpen;
  return (
    <button
      type="button"
      className={`inbox-navigation-toggle ${className}`}
      data-navigation-toggle
      aria-label={label}
      title={label}
      aria-controls="private-navigation"
      aria-expanded={navigation.visible}
      onClick={navigation.toggle}
    >
      <Icon size={20} />
    </button>
  );
}
