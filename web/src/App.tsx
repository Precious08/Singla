import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { WalletSelector } from '@near-wallet-selector/core';
import { Brand } from './components/Brand';
import { CreateJobDialog } from './components/CreateJobDialog';
import { FrontDoor } from './components/FrontDoor';
import { JobCard } from './components/JobCard';
import { JobDetails } from './components/JobDetails';
import { JobTable } from './components/JobTable';
import { ThemeToggle } from './components/ThemeToggle';
import {
  callContractMethod,
  CONTRACT_ID,
  fetchContractOwner,
  fetchTrackedJobs,
  GAS,
  initWalletSelector,
  loadTrackedJobIds,
  openWalletModal,
  trackJobId,
} from './lib/near';
import { JOB_STATES, JOB_STATE_LABELS, type DemoJob, type JobState } from './types';

type Filter = 'All' | JobState | 'Failed';

const FILTERS: readonly Filter[] = [
  'All',
  'AwaitingApproval',
  'Approved',
  'PaymentPending',
  'Paid',
  'Failed',
];

function filterLabel(filter: Filter): string {
  if (filter === 'All') return 'All';
  if (filter === 'Failed') return 'Failed';
  return JOB_STATE_LABELS[filter];
}

/** What a payment looks like on screen: a failed send shows as Failed. */
function displayState(job: DemoJob): Filter {
  return job.failed ? 'Failed' : job.state;
}

function jobsForFilter(jobs: DemoJob[], filter: Filter): DemoJob[] {
  if (filter === 'All') return jobs;
  return jobs.filter((job) => displayState(job) === filter);
}

const MOBILE_QUERY = '(max-width: 1023px)';

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return typeof window.matchMedia === 'function'
      ? window.matchMedia(MOBILE_QUERY).matches
      : window.innerWidth < 1024;
  });

  useEffect(() => {
    if (typeof window.matchMedia === 'function') {
      const query = window.matchMedia(MOBILE_QUERY);
      const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
      setIsMobile(query.matches);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return isMobile;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

const TRY_KEY = 'singla:try-payments';
const FAILED_KEY = 'singla:failed-payments';

function isStoredJob(value: unknown): value is DemoJob {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<DemoJob>;
  return (
    typeof candidate.job_id === 'string' &&
    typeof candidate.recipient === 'string' &&
    typeof candidate.amount === 'string' &&
    typeof candidate.state === 'string' &&
    (JOB_STATES as readonly string[]).includes(candidate.state)
  );
}

function loadTryJobs(): DemoJob[] {
  try {
    const raw = window.localStorage.getItem(TRY_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isStoredJob).map((job) => ({ ...job, source: 'local' as const }));
  } catch {
    return [];
  }
}

function loadFailedIds(): string[] {
  try {
    const raw = window.localStorage.getItem(FAILED_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((value): value is string => typeof value === 'string');
  } catch {
    return [];
  }
}

export default function App() {
  const [entered, setEntered] = useState<'none' | 'try' | 'live'>('none');
  const [tryJobs, setTryJobs] = useState<DemoJob[]>(loadTryJobs);
  const [liveJobs, setLiveJobs] = useState<DemoJob[]>([]);
  const [failedIds, setFailedIds] = useState<string[]>(loadFailedIds);
  const [refusedOnce, setRefusedOnce] = useState(false);
  const [filter, setFilter] = useState<Filter>('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [chipMenuOpen, setChipMenuOpen] = useState(false);

  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const stored = window.localStorage.getItem('payonce:theme');
      if (stored === 'light' || stored === 'dark') return stored;
    } catch {
      /* storage unavailable — fall through to the dark default */
    }
    return 'dark';
  });
  const enteredLiveFor = useRef<string | null>(null);
  const enterOnConnect = useRef(false);
  const chipRef = useRef<HTMLDivElement>(null);
  const tryTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem('payonce:theme', theme);
    } catch {
      /* storage unavailable — the theme still applies for this visit */
    }
  }, [theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(TRY_KEY, JSON.stringify(tryJobs));
    } catch {
      /* storage unavailable — try payments last for this visit only */
    }
  }, [tryJobs]);

  useEffect(() => {
    try {
      window.localStorage.setItem(FAILED_KEY, JSON.stringify(failedIds));
    } catch {
      /* storage unavailable */
    }
  }, [failedIds]);

  useEffect(() => {
    const timers = tryTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  // Close the account menu on an outside click or Escape.
  useEffect(() => {
    if (!chipMenuOpen) {
      return;
    }
    const onPointer = (event: MouseEvent) => {
      if (chipRef.current && !chipRef.current.contains(event.target as Node)) {
        setChipMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setChipMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [chipMenuOpen]);

  const isLive = accountId !== null;
  const inApp = entered !== 'none';

  /** Live payments carry their failed flag; try payments are their own list. */
  const jobs = useMemo<DemoJob[]>(() => {
    if (!inApp) {
      return [];
    }
    if (isLive) {
      return liveJobs.map((job) => ({
        ...job,
        failed: job.state === 'Approved' && failedIds.includes(job.job_id),
      }));
    }
    return tryJobs;
  }, [inApp, isLive, liveJobs, tryJobs, failedIds]);

  const existingIds = useMemo(
    () => new Set(jobs.map((job) => job.job_id)),
    [jobs],
  );

  const counts = useMemo(() => {
    const next: Record<Filter, number> = {
      All: jobs.length,
      AwaitingApproval: 0,
      Approved: 0,
      PaymentPending: 0,
      Paid: 0,
      Failed: 0,
    };
    for (const job of jobs) {
      next[displayState(job)] += 1;
    }
    return next;
  }, [jobs]);

  const filteredJobs = useMemo(
    () => jobsForFilter(jobs, filter),
    [jobs, filter],
  );

  const selectedJob = jobs.find((job) => job.job_id === selectedId) ?? null;
  const isMobile = useIsMobile();
  const notOwner = isLive && ownerId !== null && ownerId !== accountId;
  const tryLoopDone =
    !isLive && refusedOnce && tryJobs.some((job) => job.state === 'Paid');

  const refreshLiveJobs = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const chainJobs = await fetchTrackedJobs(loadTrackedJobIds());
      setLiveJobs(chainJobs);
      // A failure mark only survives while the chain still shows Approved.
      setFailedIds((current) =>
        current.filter((id) =>
          chainJobs.some((job) => job.job_id === id && job.state === 'Approved'),
        ),
      );
      setSelectedId((current) =>
        current && chainJobs.some((job) => job.job_id === current)
          ? current
          : (chainJobs[0]?.job_id ?? null),
      );
    } catch {
      setNotice('Could not refresh payments from the contract. Check your connection and try again.');
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Set up the wallet selector once (skipped under tests).
  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      return;
    }
    let subscription: { unsubscribe: () => void } | undefined;
    let cancelled = false;
    void (async () => {
      const instance = await initWalletSelector();
      if (!instance || cancelled) {
        return;
      }
      setSelector(instance);
      const readAccount = () => {
        const accounts = instance.store.getState().accounts;
        const active =
          accounts.find((account) => account.active) ?? accounts[0];
        setAccountId(active?.accountId ?? null);
      };
      readAccount();
      subscription = instance.store.observable.subscribe(() => readAccount());
    })();
    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, []);

  // Enter or leave live mode as the wallet connection changes.
  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      return;
    }
    if (accountId) {
      if (enterOnConnect.current) {
        enterOnConnect.current = false;
        setEntered('live');
      }
      if (enteredLiveFor.current === accountId) {
        return;
      }
      enteredLiveFor.current = accountId;
      void (async () => {
        const params = new URLSearchParams(window.location.search);
        if (params.has('transactionHashes')) {
          setNotice('Transaction submitted. Showing the latest state from the chain.');
          window.history.replaceState({}, '', window.location.pathname);
        }
        try {
          setOwnerId(await fetchContractOwner());
        } catch {
          setOwnerId(null);
        }
        await refreshLiveJobs();
      })();
    } else if (enteredLiveFor.current) {
      enteredLiveFor.current = null;
      setLiveJobs([]);
      setSelectedId(null);
      setOwnerId(null);
      setChipMenuOpen(false);
      setEntered((current) => (current === 'live' ? 'none' : current));
    }
  }, [accountId, refreshLiveJobs]);

  function toggleTheme() {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }

  function changeFilter(nextFilter: Filter) {
    setFilter(nextFilter);
    const nextJobs = jobsForFilter(jobs, nextFilter);
    if (!nextJobs.some((job) => job.job_id === selectedId)) {
      setSelectedId(nextJobs[0]?.job_id ?? null);
      setIsDetailsOpen(false);
    }
    setNotice('');
  }

  async function handleConnect() {
    if (!selector) {
      setNotice('Wallet is still loading. Try again in a moment.');
      return;
    }
    try {
      await openWalletModal(selector);
    } catch {
      setNotice('The wallet window could not be opened.');
    }
  }

  /** The header logo is the home button, in both modes: back to the front
   * door. Nothing is reset — a connected wallet stays connected (the
   * door's Connect choice walks straight back in), and the demo keeps
   * its payments (Start over is the reset there). */
  function goHome() {
    setChipMenuOpen(false);
    setIsDetailsOpen(false);
    setEntered('none');
  }

  /** The front door's Connect choice: straight in if a wallet is already
   * connected, otherwise the wallet window, entering when it connects. */
  function handleDoorConnect() {
    if (isLive) {
      setEntered('live');
      return;
    }
    enterOnConnect.current = true;
    void handleConnect();
  }

  async function handleDisconnect() {
    setChipMenuOpen(false);
    if (!selector) {
      return;
    }
    try {
      const wallet = await selector.wallet();
      await wallet.signOut();
    } catch {
      setNotice('Disconnecting the wallet failed. Try again.');
    }
  }

  async function handleCopyAddress() {
    setChipMenuOpen(false);
    if (!accountId) {
      return;
    }
    try {
      await navigator.clipboard.writeText(accountId);
      setNotice('Address copied.');
    } catch {
      setNotice(`Your address is ${accountId}`);
    }
  }

  function handleCreate(input: {
    jobId: string;
    recipient: string;
    amount: string;
  }) {
    if (!isLive || !selector) {
      const job: DemoJob = {
        job_id: input.jobId,
        recipient: input.recipient,
        amount: input.amount,
        state: 'AwaitingApproval',
        source: 'local',
      };
      setTryJobs((current) => [job, ...current]);
      setFilter('All');
      setSelectedId(job.job_id);
      setNotice('');
      return;
    }

    if (input.recipient === CONTRACT_ID) {
      setNotice('The recipient cannot be the contract account itself.');
      return;
    }

    // Track the ID before sending, so the payment is listed even if the
    // wallet redirects away and back.
    trackJobId(input.jobId);
    setFilter('All');
    setSelectedId(input.jobId);
    void (async () => {
      try {
        await callContractMethod(
          selector,
          'create_job',
          {
            job_id: input.jobId,
            recipient: input.recipient,
            amount: input.amount,
          },
          GAS.create,
        );
        setNotice(`Payment "${input.jobId}" created on the contract.`);
        await refreshLiveJobs();
      } catch (error) {
        setNotice(`Creating the payment failed: ${errorMessage(error)}`);
        await refreshLiveJobs();
      }
    })();
  }

  function handleApprove(jobId: string) {
    const job = jobs.find((candidate) => candidate.job_id === jobId);
    if (!job || job.state !== 'AwaitingApproval') {
      return;
    }

    if (!isLive || !selector) {
      setTryJobs((current) =>
        current.map((candidate) =>
          candidate.job_id === jobId
            ? { ...candidate, state: 'Approved' }
            : candidate,
        ),
      );
      return;
    }

    void (async () => {
      try {
        await callContractMethod(selector, 'approve_job', { job_id: jobId }, GAS.approve);
        setNotice(`Payment "${jobId}" approved on the contract.`);
        await refreshLiveJobs();
      } catch (error) {
        setNotice(`Approving the payment failed: ${errorMessage(error)}`);
      }
    })();
  }

  function handleExecute(jobId: string) {
    if (!isLive || !selector) {
      // Try mode: the pretend send lands after a short pending beat.
      setTryJobs((current) =>
        current.map((candidate) =>
          candidate.job_id === jobId
            ? { ...candidate, state: 'PaymentPending' }
            : candidate,
        ),
      );
      const timer = setTimeout(() => {
        tryTimers.current.delete(jobId);
        setTryJobs((current) =>
          current.map((candidate) =>
            candidate.job_id === jobId && candidate.state === 'PaymentPending'
              ? { ...candidate, state: 'Paid' }
              : candidate,
          ),
        );
      }, 2000);
      tryTimers.current.set(jobId, timer);
      return;
    }

    void (async () => {
      try {
        await callContractMethod(selector, 'execute_job', { job_id: jobId }, GAS.execute);
        setFailedIds((current) => current.filter((id) => id !== jobId));
        setNotice(
          `Execution sent for "${jobId}". The payment settles in a few seconds. Refresh to see it paid.`,
        );
        await refreshLiveJobs();
      } catch (error) {
        // The contract returns the payment to Approved when a send fails;
        // remember the failure so the page can show it as Failed.
        setFailedIds((current) =>
          current.includes(jobId) ? current : [...current, jobId],
        );
        setNotice(`Executing the payment failed: ${errorMessage(error)}`);
        await refreshLiveJobs();
      }
    })();
  }

  function handleStartOver() {
    tryTimers.current.forEach((timer) => clearTimeout(timer));
    tryTimers.current.clear();
    setTryJobs([]);
    setRefusedOnce(false);
    setFilter('All');
    setSelectedId(null);
    setNotice('');
  }

  function selectJob(jobId: string) {
    setSelectedId(jobId);
    if (isMobile) {
      setIsDetailsOpen(true);
    }
  }

  function closeDetails() {
    setIsDetailsOpen(false);
  }

  if (!inApp) {
    return (
      <>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <FrontDoor
          theme={theme}
          onToggleTheme={toggleTheme}
          onConnect={handleDoorConnect}
          onTry={() => setEntered('try')}
        />
      </>
    );
  }

  const shortAccount = accountId
    ? `${accountId.slice(0, 4)}..${accountId.slice(-4)}`
    : '';

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <div className="app-bg" aria-hidden="true">
        <div className="app-glow app-glow--a" />
        <div className="app-glow app-glow--b" />
        <svg
          className="app-signal"
          viewBox="0 0 1200 180"
          preserveAspectRatio="none"
        >
          <path d="M-20,120 C140,60 260,150 420,100 S700,40 860,95 S1100,140 1220,80" />
          <path
            className="s2"
            d="M-20,90 C160,140 300,60 470,115 S740,150 900,70 S1120,60 1220,120"
          />
        </svg>
      </div>

      <div className="page">
        <header className="header rise-app">
          <button
            type="button"
            className="brand-button"
            onClick={goHome}
            aria-label="Singla — back to the front door"
            title="Back to the front door"
          >
            <Brand />
          </button>
          <div className="header__actions">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            {isLive ? (
              <div className="chip-wrap" ref={chipRef}>
                <button
                  type="button"
                  className="chip"
                  aria-haspopup="menu"
                  aria-expanded={chipMenuOpen}
                  title={accountId ?? undefined}
                  onClick={() => setChipMenuOpen((open) => !open)}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                    <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                    <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
                  </svg>
                  <span>{shortAccount}</span>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 12 12"
                    aria-hidden="true"
                  >
                    <path
                      d="M2.5 4.5 6 8l3.5-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
                {chipMenuOpen && (
                  <div className="chip-menu" role="menu">
                    <button
                      type="button"
                      className="chip-menu__row"
                      role="menuitem"
                      onClick={() => void handleCopyAddress()}
                    >
                      Copy address
                    </button>
                    <button
                      type="button"
                      className="chip-menu__row chip-menu__row--danger"
                      role="menuitem"
                      onClick={() => void handleDisconnect()}
                    >
                      Disconnect
                    </button>
                  </div>
                )}
              </div>
            ) : entered === 'try' ? (
              <span className="demo-pill" role="status">
                Demo mode
              </span>
            ) : (
              <button
                type="button"
                className="button button--primary button--connect"
                onClick={() => void handleConnect()}
              >
                Connect wallet
              </button>
            )}
          </div>
        </header>

        {!isLive && (
          <div
            className="try-strip rise-app"
            role="note"
            style={{ animationDelay: '60ms' }}
          >
            <span>
              {tryLoopDone
                ? 'That is the whole product. Connect a wallet and it is real.'
                : 'You are trying Singla with pretend money. Nothing here touches the blockchain.'}
            </span>
            <button
              type="button"
              className="try-strip__reset"
              onClick={handleStartOver}
            >
              Start over
            </button>
          </div>
        )}

        <main id="main">
          {notOwner && (
            <p className="notice notice--warn" role="note">
              This account is not the contract owner, so the contract will
              reject create, approve, and execute calls.
            </p>
          )}

          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}

          <div
            className="controlline rise-app"
            style={{ animationDelay: '120ms' }}
          >
            <div
              className="filters"
              role="group"
              aria-label="Filter payments by status"
            >
              {FILTERS.map((target) => (
                <button
                  key={target}
                  type="button"
                  className={`filter${filter === target ? ' is-active' : ''}`}
                  aria-pressed={filter === target}
                  onClick={() => changeFilter(target)}
                >
                  {filterLabel(target)}
                  <span className="filter__count" aria-hidden="true">
                    {counts[target]}
                  </span>
                  <span className="sr-only">
                    {counts[target]}{' '}
                    {counts[target] === 1 ? 'payment' : 'payments'}
                  </span>
                </button>
              ))}
            </div>
            <div className="controlline__actions">
              {isLive && (
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => void refreshLiveJobs()}
                  disabled={isRefreshing}
                >
                  {isRefreshing ? 'Refreshing…' : 'Refresh'}
                </button>
              )}
              <button
                type="button"
                className="button button--primary button--create"
                onClick={() => setIsDialogOpen(true)}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New payment
              </button>
            </div>
          </div>

          <div
            className="content-grid rise-app"
            style={{ animationDelay: '180ms' }}
          >
            <div className="content-grid__main">
              <div className="job-cards" role="list" aria-label="Payments">
                {filteredJobs.map((job) => (
                  <JobCard
                    key={job.job_id}
                    job={job}
                    selected={job.job_id === selectedId}
                    onSelect={selectJob}
                  />
                ))}
              </div>

              <JobTable
                jobs={filteredJobs}
                selectedId={selectedId}
                onSelect={selectJob}
              />

              {filteredJobs.length === 0 && (
                <div className="empty-state">
                  {filter === 'All' ? (
                    <>
                      <p className="empty-state__title">No payments yet.</p>
                      <p>When you create a payment, it will appear here.</p>
                    </>
                  ) : (
                    <>
                      <p className="empty-state__title">No payments here.</p>
                      <p>
                        Nothing has the “{filterLabel(filter)}” status right
                        now.
                      </p>
                      <button
                        type="button"
                        className="button button--secondary"
                        onClick={() => changeFilter('All')}
                      >
                        Show all payments
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {selectedJob && (!isMobile || isDetailsOpen) && (
              <JobDetails
                key={selectedJob.job_id}
                job={selectedJob}
                mode={isLive ? 'live' : 'try'}
                onApprove={handleApprove}
                onExecute={handleExecute}
                onClose={closeDetails}
                isMobile={isMobile}
                onPayAgain={() => setRefusedOnce(true)}
              />
            )}
          </div>
        </main>
      </div>

      <CreateJobDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        existingIds={existingIds}
        onCreate={handleCreate}
        mode={isLive ? 'live' : 'try'}
      />
    </>
  );
}
