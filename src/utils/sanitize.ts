const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
};

export function sanitize(input: string): string {
  return input.replace(/[&<>"'\/]/g, character => HTML_ENTITIES[character] ?? character);
}