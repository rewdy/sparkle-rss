import '@mantine/core/styles.css';
import { MantineProvider } from '@mantine/core';
import { QueryClientProvider } from '@tanstack/react-query';
import { Provider as JotaiProvider, useAtomValue } from 'jotai';
import { Route, Switch } from 'wouter';
import { queryClient } from './lib/query-client';
import { colorSchemeAtom } from './lib/ui-state';
import { Home } from './pages/Home';

function ThemedApp() {
  const scheme = useAtomValue(colorSchemeAtom);
  return (
    <MantineProvider forceColorScheme={scheme}>
      <Switch>
        <Route path="/" component={Home} />
        <Route>
          <Home />
        </Route>
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
