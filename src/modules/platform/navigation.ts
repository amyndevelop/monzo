export const platformSections = [
  {
    slug: 'canales',
    label: 'Canales',
    description: 'Conectá los canales de atención de tu empresa.',
    icon: 'messages',
  },
  {
    slug: 'conversaciones',
    label: 'Conversaciones',
    description:
      'Un espacio para reunir las conversaciones de tu negocio y acompañar a cada cliente.',
    icon: 'messages',
  },
  {
    slug: 'contactos',
    label: 'Contactos',
    description: 'El contexto de cada cliente, sus etiquetas y su historial, en un solo lugar.',
    icon: 'contacts',
  },
  {
    slug: 'agentes-ia',
    label: 'Agentes IA',
    description: 'Asistentes con la personalidad y el conocimiento de tu negocio.',
    icon: 'sparkles',
  },
  {
    slug: 'automatizaciones',
    label: 'Automatizaciones',
    description: 'Flujos para conectar tareas, conversaciones y oportunidades.',
    icon: 'workflow',
  },
  {
    slug: 'analiticas',
    label: 'Analíticas',
    description: 'Información verificable para entender y mejorar tu atención.',
    icon: 'chart',
  },
  {
    slug: 'equipo',
    label: 'Equipo',
    description: 'Personas, roles y permisos para trabajar en conjunto.',
    icon: 'team',
  },
  {
    slug: 'configuracion',
    label: 'Configuración',
    description: 'La identidad, las preferencias y las conexiones de cada empresa.',
    icon: 'settings',
  },
] as const;
export function getSection(slug: string) {
  return platformSections.find((section) => section.slug === slug);
}
