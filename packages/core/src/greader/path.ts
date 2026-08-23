const PREFIXES = [/^\/api(?=\/)/, /^\/greader\.php(?=\/|$)/];

/**
 * Google Reader clients are sloppy about the base path: FreshRSS strips an optional
 * leading `/api` and/or `greader.php` before routing. This mirrors that leniency.
 */
export function normalizeGreaderRequestPath(pathname: string): string {
  let result = pathname;
  for (const prefix of PREFIXES) {
    result = result.replace(prefix, '');
  }
  return result;
}
