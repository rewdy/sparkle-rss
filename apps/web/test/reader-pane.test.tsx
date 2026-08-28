// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderPane } from '../src/components/ReaderPane';
import type { Entry } from '../src/lib/types';

// The pane reads subscriptions and issues read/star mutations; route those
// through a fake api so no real network happens.
vi.mock('../src/lib/api', () => ({
  api: {
    subscriptions: {
      list: vi.fn(async () => ({ subscriptions: [] })),
    },
    entries: {
      setRead: vi.fn(async () => ({ updated: 0 })),
      setStarred: vi.fn(async () => ({ updated: 0 })),
    },
  },
}));

import { MantineProvider } from '@mantine/core';
import { api as mockApi } from '../src/lib/api';

const ENTRY: Entry = {
  id: '42',
  feedId: 'f1',
  title: 'Postgres at the edge',
  url: 'https://example.com/post',
  author: 'Ada',
  contentHtml: '<p>hello <img src="https://example.com/a.png" /></p>',
  publishedAtMs: Date.UTC(2026, 7, 26, 14, 0),
  crawledAtMs: Date.UTC(2026, 7, 26, 14, 0),
  enclosures: [],
  isRead: false,
  isStarred: false,
};

let client: QueryClient;
const user = userEvent.setup();

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <MantineProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MantineProvider>
  );
}

function renderPane(props: Partial<Parameters<typeof ReaderPane>[0]> = {}) {
  render(
    <Providers>
      <ReaderPane entry={ENTRY} onClose={vi.fn()} onNext={vi.fn()} onPrev={vi.fn()} {...props} />
    </Providers>,
  );
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ReaderPane', () => {
  it('renders the article title and its content', () => {
    renderPane();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Postgres at the edge');
    expect(document.querySelector('.reading-content')).toHaveTextContent('hello');
  });

  it('marks content images lazy and async after mount', () => {
    renderPane();
    const img = document.querySelector('.reading-content img') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.loading).toBe('lazy');
    expect(img?.decoding).toBe('async');
  });

  it('calls onClose from the back button', async () => {
    const onClose = vi.fn();
    renderPane({ onClose });
    await user.click(screen.getByRole('button', { name: 'back' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('toggles read via the read action', async () => {
    renderPane();
    await user.click(screen.getByRole('button', { name: 'toggle read' }));
    expect(mockApi.entries.setRead).toHaveBeenCalledWith(['42'], true);
  });

  it('stars an entry via the star action', async () => {
    renderPane();
    await user.click(screen.getByRole('button', { name: 'star' }));
    expect(mockApi.entries.setStarred).toHaveBeenCalledWith(['42'], true);
  });

  it('wires previous and next to the reader nav buttons', async () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    renderPane({ onNext, onPrev });
    await user.click(screen.getByRole('button', { name: /next/ }));
    await user.click(screen.getByRole('button', { name: /previous/ }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });
});
