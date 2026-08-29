import { MantineProvider } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { QueryClientProvider } from '@tanstack/react-query';
import { Provider as JotaiProvider, useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { Route, Switch } from 'wouter';
import { queryClient } from './lib/query-client';
import { colorSchemeAtom, themeIdAtom } from './lib/ui-state';
import { Callback } from './pages/Callback';
import { Login } from './pages/Login';
import { Shell } from './pages/Shell';
import { THEMES } from './themes';

function ThemedApp() {
  const scheme = useAtomValue(colorSchemeAtom);
  const themeId = useAtomValue(themeIdAtom);
  const systemIsDark = useMediaQuery('(prefers-color-scheme: dark)', false, {
    getInitialValueInEffect: false,
  });
  const resolvedScheme = scheme === 'system' ? (systemIsDark ? 'dark' : 'light') : scheme;

  // Keep the browser chrome (mobile status bar / top app bar) in sync with the
  // active theme; update the existing meta tag rather than re-creating it.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = resolvedScheme === 'dark' ? '#17171b' : '#ffffff';
  }, [resolvedScheme]);

  return (
    <MantineProvider theme={THEMES[themeId]} forceColorScheme={resolvedScheme}>
      <Switch>
        <Route path="/auth/callback" component={Callback} />
        <Route path="/login" component={Login} />
        <Route component={Shell} />
      </Switch>
    </MantineProvider>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider>
        <ThemedApp />
      </JotaiProvider>
    </QueryClientProvider>
  );
}
