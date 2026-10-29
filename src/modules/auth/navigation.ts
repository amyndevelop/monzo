'use client';
/** Discard the router cache when identity or active company changes. */
export function navigateWithFreshDocument(path: '/ingresar' | '/empresas' | '/dashboard') {
  window.location.assign(new URL(path, window.location.origin));
}
