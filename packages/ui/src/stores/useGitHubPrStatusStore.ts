import { create } from 'zustand';
import type { GitHubPullRequestStatus, RuntimeAPIs } from '@/lib/api/types';

const PR_REVALIDATE_TTL_MS = 90_000;
const PR_REVALIDATE_INTERVAL_MS = 30_000;
const PR_DISCOVERY_INTERVAL_MS = 5 * 60_000;

const isTerminalPrState = (state: string | null | undefined): boolean => state === 'closed' || state === 'merged';

export const getGitHubPrStatusKey = (directory: string, branch: string, remoteName?: string | null): string =>
  `${directory}::${branch}::${remoteName ?? ''}`;

type RefreshOptions = {
  force?: boolean;
  onlyExistingPr?: boolean;
  silent?: boolean;
  markInitialResolved?: boolean;
};

type PrRuntimeParams = {
  directory: string;
  branch: string;
  remoteName: string | null;
  canShow: boolean;
  github?: RuntimeAPIs['github'];
  githubAuthChecked: boolean;
  githubConnected: boolean | null;
};

type PrStatusEntry = {
  status: GitHubPullRequestStatus | null;
  isLoading: boolean;
  error: string | null;
  isInitialStatusResolved: boolean;
  lastRefreshAt: number;
  lastDiscoveryPollAt: number;
  watchers: number;
  params: PrRuntimeParams | null;
};

type GitHubPrStatusStore = {
  entries: Record<string, PrStatusEntry>;
  ensureEntry: (key: string) => void;
  setParams: (key: string, params: PrRuntimeParams) => void;
  startWatching: (key: string) => void;
  stopWatching: (key: string) => void;
  refresh: (key: string, options?: RefreshOptions) => Promise<void>;
  updateStatus: (key: string, updater: (prev: GitHubPullRequestStatus | null) => GitHubPullRequestStatus | null) => void;
};

const timers = new Map<string, number>();
const inFlight = new Set<string>();

const createEntry = (): PrStatusEntry => ({
  status: null,
  isLoading: false,
  error: null,
  isInitialStatusResolved: false,
  lastRefreshAt: 0,
  lastDiscoveryPollAt: 0,
  watchers: 0,
  params: null,
});

export const useGitHubPrStatusStore = create<GitHubPrStatusStore>((set, get) => ({
  entries: {},

  ensureEntry: (key) => {
    set((state) => {
      if (state.entries[key]) {
        return state;
      }
      return {
        entries: {
          ...state.entries,
          [key]: createEntry(),
        },
      };
    });
  },

  setParams: (key, params) => {
    set((state) => {
      const current = state.entries[key] ?? createEntry();
      return {
        entries: {
          ...state.entries,
          [key]: {
            ...current,
            params,
          },
        },
      };
    });
  },

  startWatching: (key) => {
    set((state) => {
      const current = state.entries[key] ?? createEntry();
      return {
        entries: {
          ...state.entries,
          [key]: {
            ...current,
            watchers: current.watchers + 1,
          },
        },
      };
    });

    if (timers.has(key)) {
      return;
    }

    const timerId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }

      const entry = get().entries[key];
      if (!entry || entry.watchers <= 0) {
        return;
      }

      const hasPr = Boolean(entry.status?.pr);
      if (!hasPr) {
        const now = Date.now();
        if (now - entry.lastDiscoveryPollAt < PR_DISCOVERY_INTERVAL_MS) {
          return;
        }
        set((state) => {
          const current = state.entries[key];
          if (!current) {
            return state;
          }
          return {
            entries: {
              ...state.entries,
              [key]: {
                ...current,
                lastDiscoveryPollAt: now,
              },
            },
          };
        });
        void get().refresh(key, { force: true, silent: true, markInitialResolved: true });
        return;
      }

      if (isTerminalPrState(entry.status?.pr?.state)) {
        return;
      }

      void get().refresh(key, { force: true, onlyExistingPr: true, silent: true, markInitialResolved: true });
    }, PR_REVALIDATE_INTERVAL_MS);

    timers.set(key, timerId);
  },

  stopWatching: (key) => {
    set((state) => {
      const current = state.entries[key];
      if (!current) {
        return state;
      }

      const watchers = Math.max(0, current.watchers - 1);
      return {
        entries: {
          ...state.entries,
          [key]: {
            ...current,
            watchers,
          },
        },
      };
    });

    const entry = get().entries[key];
    if (entry && entry.watchers > 0) {
      return;
    }

    const timerId = timers.get(key);
    if (typeof timerId === 'number') {
      window.clearInterval(timerId);
    }
    timers.delete(key);
  },

  refresh: async (key, options) => {
    const state = get();
    const entry = state.entries[key];
    const params = entry?.params;

    if (!entry || !params || !params.canShow) {
      return;
    }
    if (options?.onlyExistingPr && !entry.status?.pr) {
      return;
    }
    if (!options?.force && Date.now() - entry.lastRefreshAt < PR_REVALIDATE_TTL_MS) {
      return;
    }
    if (inFlight.has(key)) {
      return;
    }

    inFlight.add(key);

    set((prev) => {
      const current = prev.entries[key];
      if (!current) {
        return prev;
      }
      return {
        entries: {
          ...prev.entries,
          [key]: {
            ...current,
            lastRefreshAt: Date.now(),
            isLoading: options?.silent ? current.isLoading : true,
            error: null,
          },
        },
      };
    });

    if (params.githubAuthChecked && params.githubConnected === false) {
      set((prev) => {
        const current = prev.entries[key];
        if (!current) {
          return prev;
        }
        return {
          entries: {
            ...prev.entries,
            [key]: {
              ...current,
              status: { connected: false },
              error: null,
              isLoading: options?.silent ? current.isLoading : false,
              isInitialStatusResolved: options?.markInitialResolved === false ? current.isInitialStatusResolved : true,
            },
          },
        };
      });
      inFlight.delete(key);
      return;
    }

    if (!params.github?.prStatus) {
      set((prev) => {
        const current = prev.entries[key];
        if (!current) {
          return prev;
        }
        return {
          entries: {
            ...prev.entries,
            [key]: {
              ...current,
              status: null,
              error: 'GitHub runtime API unavailable',
              isLoading: options?.silent ? current.isLoading : false,
              isInitialStatusResolved: options?.markInitialResolved === false ? current.isInitialStatusResolved : true,
            },
          },
        };
      });
      inFlight.delete(key);
      return;
    }

    try {
      const next = await params.github.prStatus(params.directory, params.branch, params.remoteName ?? undefined);
      set((prev) => {
        const current = prev.entries[key];
        if (!current) {
          return prev;
        }

        const prevPr = current.status?.pr;
        const nextPr = next.pr;
        const shouldCarryBody = Boolean(
          nextPr
          && prevPr
          && nextPr.number === prevPr.number
          && (!nextPr.body || !nextPr.body.trim())
          && typeof prevPr.body === 'string'
          && prevPr.body.trim().length > 0,
        );

        const status = shouldCarryBody && nextPr && prevPr?.body
          ? {
            ...next,
            pr: {
              ...nextPr,
              body: prevPr.body,
            },
          }
          : next;

        return {
          entries: {
            ...prev.entries,
            [key]: {
              ...current,
              status,
              error: null,
              isLoading: options?.silent ? current.isLoading : false,
              isInitialStatusResolved: options?.markInitialResolved === false ? current.isInitialStatusResolved : true,
            },
          },
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((prev) => {
        const current = prev.entries[key];
        if (!current) {
          return prev;
        }
        return {
          entries: {
            ...prev.entries,
            [key]: {
              ...current,
              error: message || 'Failed to load PR status',
              isLoading: options?.silent ? current.isLoading : false,
              isInitialStatusResolved: options?.markInitialResolved === false ? current.isInitialStatusResolved : true,
            },
          },
        };
      });
    } finally {
      inFlight.delete(key);
    }
  },

  updateStatus: (key, updater) => {
    set((state) => {
      const current = state.entries[key] ?? createEntry();
      return {
        entries: {
          ...state.entries,
          [key]: {
            ...current,
            status: updater(current.status),
          },
        },
      };
    });
  },
}));
