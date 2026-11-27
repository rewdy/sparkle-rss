import { AppShell, Center, Loader } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import type { ReactElement } from "react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useSearch } from "wouter";
import { useSearch as useRawSearch } from "wouter/use-browser-location";
import { ChannelEndPane } from "../components/ChannelEndPane";
import { PageTitle } from "../components/PageTitle";
import { ReaderPane } from "../components/ReaderPane";
import { SavedImagePane } from "../components/SavedImagePane";
import { SavedList } from "../components/SavedList";
import { Sidebar } from "../components/Sidebar";
import { StreamInner } from "../components/StreamInner";
import { Topbar } from "../components/Topbar";
import { ApiError, api } from "../lib/api";
import { homeViewFromSettings } from "../lib/home-view";
import {
  filterFromSearch,
  legacyStoryStream,
  localDateKey,
  parseRoute,
  qk,
  sortFromSearch,
  streamPath,
  viewSearch,
} from "../lib/keys";
import {
  useMarkRead,
  useMarkReadLater,
  useRemoveReadLater,
  useToggleReadLater,
  useToggleStar,
} from "../lib/mutations";
import { readerNavigation } from "../lib/reader-navigation";
import { useSavedLibrary } from "../lib/saved-queries";
import type { Entry, StreamDescriptor } from "../lib/types";
import { isEntryStream } from "../lib/types";
import {
  applySettings,
  markReadOnOpenAtom,
  shortcutsOpenAtom,
  streamPresentationAtom,
  todayRolloverAtom,
} from "../lib/ui-state";
import { FullscreenLoader, SessionRestoreError, useAuthGuard } from "./guard";

// Settings drags the heaviest non-essential Mantine components (forms, copy
// button, switches); keep them off the first-paint critical path.
const SettingsPage = lazy(() =>
  import("./Settings").then((m) => ({ default: m.SettingsPage })),
);
// Shortcut sheet + its Modal/Table are only needed when opened with `?`.
const ShortcutsModal = lazy(() =>
  import("../components/ShortcutsModal").then((m) => ({
    default: m.ShortcutsModal,
  })),
);
// The bookmarklet opens this form in a popup window: keep it out of the
// first-paint critical path.
const SaveArticleForm = lazy(() =>
  import("../components/SaveArticleForm").then((m) => ({
    default: m.SaveArticleForm,
  })),
);
const SubscribePage = lazy(() =>
  import("../components/SubscribePage").then((m) => ({
    default: m.SubscribePage,
  })),
);

function streamTitle(
  d: StreamDescriptor,
  subs: Array<{ feedId: string; displayTitle: string }>,
  folders: Array<{ id: string; name: string }>,
): string {
  switch (d.kind) {
    case "all":
      return "All items";
    case "starred":
      return "Saved";
    case "readLater":
      return "Read later";
    case "today":
      return "Today";
    case "unread":
      return "Unread";
    case "feed":
      return (
        subs.find((s) => s.feedId === d.id)?.displayTitle ?? `feed ${d.id}`
      );
    case "folder":
      return folders.find((f) => f.id === d.id)?.name ?? `folder ${d.id}`;
  }
}

/** Re-renders the tree at the next local midnight so date-keyed views roll over. */
function useMidnightTick(): void {
  const setToday = useSetAtom(todayRolloverAtom);
  useEffect(() => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = setTimeout(
      () => setToday(localDateKey()),
      next.getTime() - now.getTime() + 1000,
    );
    return () => clearTimeout(timer);
  }, [setToday]);
}

export function Shell(): ReactElement {
  const authState = useAuthGuard();
  const [location, navigate] = useLocation();
  // wouter's useLocation returns the path only; the query string (view prefs)
  // is read separately so ?filter=&sort= changes re-render this component.
  const search = useSearch();
  const rawSearch = useRawSearch();
  const readerNav = useMemo(() => readerNavigation(navigate), [navigate]);
  // Mobile navbar drawer: collapsed.mobile is ignored at/above `sm`, so this
  // state only affects phones where the sidebar is hidden until the Burger opens it.
  const [navOpened, { toggle: toggleNav, close: closeNav }] =
    useDisclosure(false);

  const filter = useMemo(() => filterFromSearch(search), [search]);
  const sort = useMemo(() => sortFromSearch(search), [search]);

  // Re-render at local midnight so "today" stream keys roll over on their own.
  useMidnightTick();

  const setShortcutsOpen = useSetAtom(shortcutsOpenAtom);
  const shortcutsOpen = useAtomValue(shortcutsOpenAtom);
  const markReadOnOpen = useAtomValue(markReadOnOpenAtom);
  const presentation = useAtomValue(streamPresentationAtom);
  const setPresentation = useSetAtom(streamPresentationAtom);
  const markRead = useMarkRead();
  const toggleStar = useToggleStar();
  const markReadLater = useMarkReadLater();
  const toggleReadLater = useToggleReadLater();
  const removeReadLater = useRemoveReadLater();

  const isHome = location === "/";
  const route = useMemo(() => parseRoute(location), [location]);
  const descriptor = route?.stream ?? null;
  const routeEntryId = route?.entryId ?? null;
  const imageId = route?.imageId ?? null;
  const endAfterId = route?.endAfterId ?? null;
  const queryClient = useQueryClient();
  const readerView = `${location}?${search}:${localDateKey()}`;
  const pendingStep = useRef<object | null>(null);
  const [step, setStepStatus] = useState<{
    view: string;
    status: "idle" | "loading" | "error" | "unavailable";
  }>({ view: readerView, status: "idle" });
  const stepStatus = step.view === readerView ? step.status : "idle";
  useLayoutEffect(() => {
    setStepStatus({ view: readerView, status: "idle" });
    return () => {
      pendingStep.current = null;
    };
  }, [readerView]);

  const runStep = useCallback(
    (run: (isCurrent: () => boolean) => Promise<void>) => {
      if (pendingStep.current) return;
      const token = {};
      const href = window.location.href;
      pendingStep.current = token;
      const isCurrent = () =>
        pendingStep.current === token && window.location.href === href;
      setStepStatus({ view: readerView, status: "loading" });
      void run(isCurrent)
        .catch(() => {
          if (isCurrent()) setStepStatus({ view: readerView, status: "error" });
        })
        .finally(() => {
          if (pendingStep.current === token) pendingStep.current = null;
        });
    },
    [readerView],
  );

  const subsQ = useQuery({
    queryKey: qk.subscriptions,
    queryFn: api.subscriptions.list,
  });
  const foldersQ = useQuery({
    queryKey: qk.folders,
    queryFn: api.folders.list,
  });
  const settingsQ = useQuery({
    queryKey: qk.settings,
    queryFn: api.settings.get,
    enabled: authState === "authed",
  });
  const homeView = homeViewFromSettings(settingsQ.data?.data.homeView);
  const homeReady = settingsQ.data !== undefined || settingsQ.isError;

  useEffect(() => {
    if (authState !== "authed" || !isHome || !homeReady) return;
    const params = viewSearch(homeView === "unread" ? "all" : filter, sort);
    navigate(`${streamPath({ kind: homeView })}${params}`, { replace: true });
  }, [authState, isHome, homeReady, homeView, filter, sort, navigate]);

  // Reconcile account-level settings (source of truth) into the atoms once the
  // fetch lands; `applySettings` ignores device-local keys such as colorScheme.
  useEffect(() => {
    if (settingsQ.data) applySettings(settingsQ.data.data);
  }, [settingsQ.data]);

  // Flat entry list for keyboard navigation / seeding the reader. Reads the
  // same infinite entries cache all stream views share (react-query coalesces
  // identical keys), without a local duplicate of server state.
  const activeStream = descriptor ?? { kind: "all" as const };
  const entriesQ = useInfiniteQuery({
    queryKey: qk.entries(activeStream, filter, sort),
    queryFn: ({ pageParam }) =>
      api.entries.list(activeStream, {
        filter,
        sort,
        limit: 50,
        cursor: pageParam as string | undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: descriptor !== null && descriptor.kind !== "starred",
  });
  const savedQ = useSavedLibrary(sort, descriptor?.kind === "starred");
  const entriesCache = useMemo(
    () =>
      descriptor?.kind === "starred"
        ? (savedQ.data?.pages.flatMap((page) =>
            page.items.flatMap((item) =>
              item.kind === "article" ? [item.entry] : [],
            ),
          ) ?? [])
        : (entriesQ.data?.pages.flatMap((page) => page.items) ?? []),
    [descriptor?.kind, savedQ.data, entriesQ.data],
  );

  useEffect(() => {
    const legacyStream = legacyStoryStream(location);
    if (!legacyStream) return;
    const legacyFilter = legacyStream.kind === "starred" ? "all" : filter;
    navigate(`${streamPath(legacyStream)}${viewSearch(legacyFilter, sort)}`, {
      replace: true,
      state: window.history.state,
    });
  }, [location, filter, sort, navigate]);

  // Source of truth for the open entry is the react-query cache (mutations
  // patch it optimistically); seed it from the stream cache to avoid a flash.
  const cachedEntry = useMemo(
    () =>
      routeEntryId
        ? (entriesCache.find((e) => e.id === routeEntryId) ?? null)
        : null,
    [entriesCache, routeEntryId],
  );
  const entryQ = useQuery({
    queryKey: routeEntryId ? qk.entry(routeEntryId) : ["entry", null],
    queryFn: () => api.entries.get(routeEntryId as string),
    enabled: routeEntryId !== null,
    initialData: cachedEntry ? { entry: cachedEntry } : undefined,
    retry: (_count, error) =>
      !(error instanceof ApiError && error.status === 404),
  });
  const activeEntry = entryQ.data?.entry ?? null;
  const entryLoading =
    routeEntryId !== null &&
    !cachedEntry &&
    entryQ.isPending &&
    entryQ.isFetching;

  // 404 on a deep-linked entry: close back to the bare stream route.
  useEffect(() => {
    if (
      descriptor &&
      routeEntryId !== null &&
      entryQ.error instanceof ApiError &&
      entryQ.error.status === 404
    ) {
      navigate(`${streamPath(descriptor)}${viewSearch(filter, sort)}`, {
        replace: true,
      });
    }
  }, [descriptor, routeEntryId, entryQ.error, filter, sort, navigate]);

  // Mark-on-open uses the right endpoint for the stream: saved items are
  // addressed by uuid, entries by their numeric id.
  const markOpened = useCallback(
    (entry: Entry): void => {
      if (!markReadOnOpen) return;
      if (descriptor?.kind === "readLater")
        markReadLater.mutate({ ids: [entry.id], read: true });
      else markRead.mutate({ ids: [entry.id], read: true });
    },
    [descriptor, markRead, markReadLater, markReadOnOpen],
  );

  // Stable callback: rows in the virtualized list are memoized on it.
  const openEntry = useCallback(
    (entry: Entry) => {
      if (!descriptor) return;
      pendingStep.current = null;
      markOpened(entry);
      readerNav.open(
        `${streamPath(descriptor)}/e/${entry.id}${viewSearch(filter, sort)}`,
      );
    },
    [descriptor, filter, sort, markOpened, readerNav],
  );

  const closeReader = useCallback((): void => {
    if (!descriptor) return;
    pendingStep.current = null;
    readerNav.close(`${streamPath(descriptor)}${viewSearch(filter, sort)}`);
  }, [descriptor, filter, sort, readerNav]);

  const move = useCallback(
    (delta: 1 | -1): void => {
      if (!descriptor || (delta === 1 && pendingStep.current)) return;
      if (endAfterId) {
        if (delta === 1 || stepStatus === "unavailable") return;
        runStep(async (isCurrent) => {
          try {
            const result = await queryClient.fetchQuery({
              queryKey: qk.entry(endAfterId),
              queryFn: () => api.entries.get(endAfterId),
              retry: false,
            });
            if (isCurrent()) openEntry(result.entry);
          } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 404)
              throw error;
            if (isCurrent())
              setStepStatus({ view: readerView, status: "unavailable" });
          }
        });
        return;
      }
      const idx = routeEntryId
        ? entriesCache.findIndex((e) => e.id === routeEntryId)
        : -1;
      const next =
        idx === -1 ? (delta === 1 ? 0 : entriesCache.length - 1) : idx + delta;
      const target = entriesCache[next];
      if (target && target.id !== routeEntryId) {
        openEntry(target);
        return;
      }
      if (
        delta !== 1 ||
        !routeEntryId ||
        idx < 0 ||
        !["all", "unread", "today"].includes(descriptor.kind)
      )
        return;

      runStep(async (isCurrent) => {
        let pageResult =
          entriesQ.isFetching ||
          (entriesQ.isError && !entriesQ.isFetchNextPageError)
            ? await entriesQ.refetch({
                throwOnError: true,
                cancelRefetch: false,
              })
            : entriesQ;
        while (isCurrent()) {
          const pages = pageResult.data?.pages ?? [];
          const entries = pages.flatMap((page) => page.items);
          const anchor = entries.findIndex(
            (entry) => entry.id === routeEntryId,
          );
          const successor = anchor >= 0 ? entries[anchor + 1] : undefined;
          if (successor) {
            openEntry(successor);
            return;
          }
          if (pages.at(-1)?.nextCursor == null) {
            if (anchor >= 0 && !pageResult.isError) {
              readerNav.open(
                `${streamPath(descriptor)}/e/${routeEntryId}/end${viewSearch(filter, sort)}`,
              );
            } else {
              setStepStatus({ view: readerView, status: "idle" });
            }
            return;
          }
          pageResult = await entriesQ.fetchNextPage({
            throwOnError: true,
            cancelRefetch: false,
          });
        }
      });
    },
    [
      descriptor,
      endAfterId,
      entriesCache,
      entriesQ,
      filter,
      openEntry,
      queryClient,
      readerNav,
      readerView,
      routeEntryId,
      runStep,
      sort,
      stepStatus,
    ],
  );

  function onFilterChange(next: "all" | "unread"): void {
    if (!descriptor) return;
    // If a reader is open, drop back to the bare stream while switching filter.
    navigate(`${streamPath(descriptor)}${viewSearch(next, sort)}`, {
      replace: true,
    });
  }

  // global hotkeys
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

      if (e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        const target = descriptor ?? { kind: "all" as const };
        // 'today' would mark ALL of today's API stream read — skip it, and
        // read later is not an entry stream at all.
        if (
          target.kind === "today" ||
          target.kind === "starred" ||
          !isEntryStream(target) ||
          imageId ||
          endAfterId
        )
          return;
        void api.entries.markAllRead(target).catch(() => undefined);
        return;
      }
      switch (e.key) {
        case "?":
          setShortcutsOpen((open) => !open);
          break;
        case "Escape":
          if (routeEntryId !== null || imageId !== null || endAfterId !== null)
            closeReader();
          break;
        case "j":
          if (imageId) break;
          e.preventDefault();
          move(1);
          break;
        case "k":
          if (imageId) break;
          e.preventDefault();
          move(-1);
          break;
        case "m":
          if (activeEntry)
            markRead.mutate({
              ids: [activeEntry.id],
              read: !activeEntry.isRead,
            });
          break;
        case "s":
          if (activeEntry)
            toggleStar.mutate({
              ids: [activeEntry.id],
              starred: !activeEntry.isStarred,
            });
          break;
        case "l":
          if (!activeEntry) break;
          // Inside the queue the same key clears the item instead of re-saving it.
          if (descriptor?.kind === "readLater")
            removeReadLater.mutate([activeEntry.id]);
          else
            toggleReadLater.mutate({
              ids: [activeEntry.id],
              save: !activeEntry.isReadLater,
            });
          break;
        default:
          break;
      }
    },
    [
      descriptor,
      imageId,
      endAfterId,
      routeEntryId,
      activeEntry,
      move,
      closeReader,
      setShortcutsOpen,
      markRead,
      toggleStar,
      toggleReadLater,
      removeReadLater,
    ],
  );

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  if (authState === "error") return <SessionRestoreError />;
  if (authState !== "authed") {
    return <FullscreenLoader label="checking session…" />;
  }

  if (isHome) return <FullscreenLoader label="loading home…" />;

  const APP_NAME = "Sparkle RSS";
  if (location === "/subscribe") {
    return (
      <Suspense fallback={<FullscreenLoader label="loading…" />}>
        <PageTitle title={`Subscribe · ${APP_NAME}`} />
        <SubscribePage search={rawSearch} />
      </Suspense>
    );
  }
  const isSettings = location.startsWith("/settings");
  const isSaveArticle = location.startsWith("/read-later/new");
  // The bookmarklet opens the save form in its own popup window. Same route and
  // prefilled params, but the window gets the bare form instead of app chrome:
  // a 650x530 popup has no room for the sidebar, topbar, or intro copy.
  const isSaveArticlePopup =
    isSaveArticle &&
    (new URLSearchParams(search).get("popup") === "1" ||
      Boolean(window.opener));
  const pageTitle = isSettings
    ? `Settings · ${APP_NAME}`
    : isSaveArticle
      ? `Save to read later · ${APP_NAME}`
      : descriptor
        ? `${streamTitle(
            descriptor,
            subsQ.data?.subscriptions ?? [],
            foldersQ.data?.folders ?? [],
          )} · ${APP_NAME}`
        : APP_NAME;

  if (isSaveArticlePopup) {
    return (
      <Suspense
        fallback={
          <Center mih="100vh">
            <Loader size="sm" type="dots" />
          </Center>
        }
      >
        <PageTitle title={pageTitle} />
        <SaveArticleForm variant="popup" />
      </Suspense>
    );
  }

  return (
    <AppShell
      header={{ height: 44 }}
      navbar={{
        width: 260,
        breakpoint: "sm",
        collapsed: { mobile: !navOpened },
      }}
      padding={0}
    >
      <PageTitle title={pageTitle} />
      <AppShell.Header data-app-header="true">
        <Topbar
          stream={descriptor ?? { kind: "all" }}
          title={
            isSettings
              ? "settings"
              : isSaveArticle
                ? "read later"
                : descriptor
                  ? streamTitle(
                      descriptor,
                      subsQ.data?.subscriptions ?? [],
                      foldersQ.data?.folders ?? [],
                    )
                  : ""
          }
          filter={filter}
          onFilterChange={onFilterChange}
          navOpened={navOpened}
          onToggleNav={toggleNav}
          presentation={presentation}
          onPresentationChange={setPresentation}
        />
      </AppShell.Header>

      <AppShell.Navbar p={0} style={{ overflow: "hidden" }}>
        <Sidebar homeView={homeView} onNavigate={closeNav} />
      </AppShell.Navbar>

      <AppShell.Main style={{ position: "relative" }}>
        {descriptor?.kind === "starred" && (
          <SavedList
            sort={sort}
            hidden={routeEntryId !== null || imageId !== null}
            onSelectArticle={openEntry}
            onSelectImage={(id) =>
              readerNav.open(`/starred/images/${id}${viewSearch("all", sort)}`)
            }
          />
        )}
        {isSettings ? (
          <Suspense
            fallback={
              <Center mih="100%">
                <Loader size="sm" type="dots" />
              </Center>
            }
          >
            <SettingsPage />
          </Suspense>
        ) : isSaveArticle ? (
          <Suspense
            fallback={
              <Center h="calc(100dvh - var(--app-shell-header-offset, 0rem))">
                <Loader size="sm" type="dots" />
              </Center>
            }
          >
            <SaveArticleForm variant="page" />
          </Suspense>
        ) : descriptor ? (
          endAfterId !== null ? (
            <ChannelEndPane
              channel={
                descriptor.kind === "today"
                  ? "Today"
                  : descriptor.kind === "unread"
                    ? "Unread"
                    : "All"
              }
              channelHref={`${streamPath(descriptor)}${viewSearch(filter, sort)}`}
              onClose={closeReader}
              onPrevious={() => move(-1)}
              previousStatus={stepStatus}
            />
          ) : imageId !== null ? (
            <SavedImagePane
              id={imageId}
              sort={sort}
              onClose={closeReader}
              onRemoved={() =>
                navigate(`/starred${viewSearch("all", sort)}`, {
                  replace: true,
                })
              }
            />
          ) : routeEntryId !== null ? (
            entryLoading ? (
              <Center h="calc(100dvh - var(--app-shell-header-offset, 0rem))">
                <Loader size="sm" type="dots" />
              </Center>
            ) : activeEntry ? (
              <ReaderPane
                entry={activeEntry}
                readLater={descriptor.kind === "readLater"}
                onClose={closeReader}
                onNext={() => move(1)}
                onPrev={() => move(-1)}
                nextStatus={stepStatus === "unavailable" ? "idle" : stepStatus}
              />
            ) : null
          ) : null
        ) : (
          <div />
        )}
        {descriptor &&
          descriptor.kind !== "starred" &&
          !isSettings &&
          !isSaveArticle && (
            <StreamInner
              key={`${streamPath(descriptor)}:${filter}:${sort}`}
              stream={descriptor}
              filter={filter}
              sort={sort}
              activeEntryId={routeEntryId ?? endAfterId}
              onSelect={openEntry}
              presentation={presentation}
              hidden={routeEntryId !== null || endAfterId !== null}
            />
          )}
      </AppShell.Main>

      {shortcutsOpen && (
        <Suspense fallback={null}>
          <ShortcutsModal />
        </Suspense>
      )}
    </AppShell>
  );
}
