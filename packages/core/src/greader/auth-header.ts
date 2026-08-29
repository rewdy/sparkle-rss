export interface GreaderCredentials {
  user: string;
  secret: string;
}

const HEADER_RE = /^GoogleLogin[\s_]auth[=](.+)$/i;

export function parseGoogleLoginHeader(
  header: string | undefined | null,
): GreaderCredentials | null {
  if (!header) return null;
  const match = HEADER_RE.exec(header.trim());
  if (!match?.[1]) return null;
  const separator = match[1].indexOf("/");
  if (separator <= 0) return null;
  return {
    user: match[1].slice(0, separator),
    secret: match[1].slice(separator + 1),
  };
}
