import type { ReactElement } from 'react';
import { PageTitle } from '../components/PageTitle';
import { FullscreenLoader, useAuthGuard } from './guard';

export function Login(): ReactElement {
  const _state = useAuthGuard();
  return (
    <>
      <PageTitle title="Sign in · Sparkle RSS" />
      <FullscreenLoader label="redirecting to sign-in…" />
    </>
  );
}
