/** Denegación por defecto hasta implementar identidad y membresía verificadas en Fase 2. */
export function requireTenantAccess(): never {
  throw new Error(
    'Acceso operativo no disponible: autenticación y autorización pendientes de Fase 2.',
  );
}
