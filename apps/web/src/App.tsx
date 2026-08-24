import { MantineProvider } from '@mantine/core';
import { QueryClientProvider } from '@tanstack/react-query';
import { Provider as JotaiProvider, useAtomValue } from 'jotai';
import { Route, Switch } from 'wouter';
import { queryClient } from './lib/query-client';
import { colorSchemeAtom } from './lib/ui-state';
import { Callback } from './pages/Callback';
import { Login } from './pages/Login';
import { Shell } from './pages/Shell';
import { theme } from './theme';

function ThemedApp() {
  const scheme = useAtomValue(colorSchemeAtom);
  return (
    <MantineProvider theme={theme} forceColorScheme={scheme}>
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
