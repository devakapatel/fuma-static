/** Only allow same-site relative paths, never protocol-relative or absolute URLs. */
export function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}
