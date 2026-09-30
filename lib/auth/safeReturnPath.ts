/** Accept only same-origin absolute paths for post-login navigation. */
export function safeReturnPath(value: string | null, fallback: string): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return fallback;
  }

  try {
    const destination = new URL(value, 'https://nexus.invalid');
    if (destination.origin !== 'https://nexus.invalid') return fallback;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return fallback;
  }
}
