/** Only the subscription popup can opt into returning after authentication. */
export function subscriptionReturnTo(value: string | null): string {
  if (
    !value?.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    [...value].some((character) => character.charCodeAt(0) <= 32)
  )
    return "/";
  try {
    // Reject invalid percent escapes as well as normalized/encoded path tricks.
    decodeURIComponent(value);
    const parsed = new URL(value, "https://sparkle.invalid");
    if (
      parsed.origin !== "https://sparkle.invalid" ||
      parsed.pathname !== "/subscribe" ||
      value.split("?")[0] !== "/subscribe"
    )
      return "/";
    return parsed.pathname + parsed.search;
  } catch {
    return "/";
  }
}

export function loginPath(destination: string): string {
  const returnTo = subscriptionReturnTo(destination);
  return returnTo === "/"
    ? "/login"
    : `/login?${new URLSearchParams({ returnTo })}`;
}
