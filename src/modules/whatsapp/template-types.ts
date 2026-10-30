export type TemplateParameter = {
  key: string;
  name: string;
  component: 'header' | 'body' | 'button';
  label: string;
  example: string;
  maxLength: number;
};
export type TemplateButton = {
  type: 'URL' | 'PHONE_NUMBER' | 'QUICK_REPLY';
  text: string;
  url?: string;
  phoneNumber?: string;
  parameterKey?: string;
  index: number;
};
export type TemplateDefinition = {
  name: string;
  language: string;
  category: string;
  parameterFormat: 'POSITIONAL' | 'NAMED';
  header: { format: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'NONE'; text: string };
  body: string;
  footer: string;
  buttons: TemplateButton[];
  parameters: TemplateParameter[];
  unsupportedReason: string | null;
};
export type TemplateItem = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  definition: TemplateDefinition;
  definitionHash: string;
};
export type TemplateCatalog = {
  items: TemplateItem[];
  canSync: boolean;
  syncedAt: string | null;
  hasMore: boolean;
  enabled: boolean;
  total: number;
  nextPage: string | null;
  languages: string[];
  selection: TemplateItem | null;
};
export type TemplatePreview = {
  name: string;
  language: string;
  category: string;
  header: TemplateDefinition['header'];
  body: string;
  footer: string;
  buttons: TemplateButton[];
};
export const templateStatusLabels: Record<string, string> = {
  APPROVED: 'Aprobada',
  PENDING: 'En revisión',
  REJECTED: 'Rechazada',
  PAUSED: 'Pausada',
  DISABLED: 'Deshabilitada',
  UNAVAILABLE: 'No disponible',
  IN_APPEAL: 'En revisión',
};
export const templateCategoryLabels: Record<string, string> = {
  UTILITY: 'Utilidad',
  MARKETING: 'Marketing',
  AUTHENTICATION: 'Autenticación',
};
export function templateLanguageLabel(code: string) {
  try {
    return new Intl.DisplayNames(['es'], { type: 'language' }).of(code.replace('_', '-')) ?? code;
  } catch {
    return code;
  }
}
export function renderTemplatePreview(
  definition: TemplateDefinition,
  values: Record<string, string>,
): TemplatePreview {
  function interpolate(
    text: string,
    component: TemplateParameter['component'],
    buttonIndex?: number,
  ) {
    return text.replace(
      /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
      (original, name: string) =>
        values[component === 'button' ? `button:${buttonIndex}:${name}` : `${component}:${name}`] ??
        original,
    );
  }
  return {
    name: definition.name,
    language: definition.language,
    category: definition.category,
    header: { ...definition.header, text: interpolate(definition.header.text, 'header') },
    body: interpolate(definition.body, 'body'),
    footer: definition.footer,
    buttons: definition.buttons.map((button) => ({
      ...button,
      ...(button.url ? { url: interpolate(button.url, 'button', button.index) } : {}),
    })),
  };
}
