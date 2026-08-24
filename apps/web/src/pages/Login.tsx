import type { ReactElement } from 'react';
import { FullscreenLoader, useAuthGuard } from './guard';

export function Login(): ReactElement {
  const _state = useAuthGuard();
  return <FullscreenLoader label="redirecting to sign-in…" />;
}
