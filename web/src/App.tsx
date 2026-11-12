import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { WalletSelector } from '@near-wallet-selector/core';
import { CreateJobDialog } from './components/CreateJobDialog';
import { JobCard } from './components/JobCard';
import { JobDetails } from './components/JobDetails';
import { JobTable } from './components/JobTable';
import { createFixtureJobs, FIXTURE_JOBS } from './fixtures';
import {
  callContractMethod,
  CONTRACT_ID,
  fetchContractJob,
  fetchContractOwner,
  fetchTrackedJobs,
  GAS,
  initWalletSelector,
  loadTrackedJobIds,
  openWalletModal,
  trackJobId,
} from './lib/near';
import { JOB_STATES, JOB_STATE_LABELS, type DemoJob, type JobState } from './types';

type Filter = 'All' | JobState;

const FILTERS: readonly Filter[] = ['All', ...JOB_STATES];

function filterLabel(filter: Filter): string {
  return filter === 'All' ? 'All' : JOB_STATE_LABELS[filter];
}

function jobsForFilter(jobs: DemoJob[], filter: Filter): DemoJob[] {
  return filter === 'All' ? jobs : jobs.filter((job) => job.state === filter);
}

const MOBILE_QUERY = '(max-width: 767px)';

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return typeof window.matchMedia === 'function'
      ? window.matchMedia(MOBILE_QUERY).matches
      : window.innerWidth < 768;
  });

  useEffect(() => {
    if (typeof window.matchMedia === 'function') {
      const query = window.matchMedia(MOBILE_QUERY);
      const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
      setIsMobile(query.matches);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    const onResize = () => setIsMobile(window.innerWidth < 768);
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

export default function App() {
  const [jobs, setJobs] = useState<DemoJob[]>(createFixtureJobs);
  const [filter, setFilter] = useState<Filter>('All');
  const [selectedId, setSelectedId] = useState<string | null>(
    FIXTURE_JOBS[0]?.job_id ?? null,
  );
  const [notice, setNotice] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [trackInput, setTrackInput] = useState('');
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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem('payonce:theme', theme);
    } catch {
      /* storage unavailable — the theme still applies for this visit */
    }
  }, [theme]);

  const isLive = accountId !== null;

  const existingIds = useMemo(
    () => new Set(jobs.map((job) => job.job_id)),
    [jobs],
  );

  const counts = useMemo(() => {
    const next: Record<JobState, number> = {
      AwaitingApproval: 0,
      Approved: 0,
      PaymentPending: 0,
      Paid: 0,
    };
    for (const job of jobs) {
      next[job.state] += 1;
    }
    return next;
  }, [jobs]);

  const filteredJobs = useMemo(
    () => jobsForFilter(jobs, filter),
    [jobs, filter],
  );

  const selectedJob = jobs.find((job) => job.job_id === selectedId) ?? null;
  const isMobile = useIsMobile();

  const refreshLiveJobs = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const chainJobs = await fetchTrackedJobs(loadTrackedJobIds());
      setJobs(chainJobs);
      setSelectedId((current) =>
        current && chainJobs.some((job) => job.job_id === current)
          ? current
          : (chainJobs[0]?.job_id ?? null),
      );
    } catch {
      setNotice('Could not refresh jobs from the contract. Check your connection and try again.');
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
      if (enteredLiveFor.current === accountId) {
        return;
      }
      enteredLiveFor.current = accountId;
      void (async () => {
        const params = new URLSearchParams(window.location.search);
        if (params.has('transactionHashes')) {
          setNotice('Transaction submitted — showing the latest state from the chain.');
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
      setJobs(createFixtureJobs());
      setFilter('All');
      setSelectedId(FIXTURE_JOBS[0]?.job_id ?? null);
      setOwnerId(null);
    }
  }, [accountId, refreshLiveJobs]);

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
      setNotice('Wallet is still loading — try again in a moment.');
      return;
    }
    try {
      await openWalletModal(selector);
    } catch {
      setNotice('The wallet window could not be opened.');
    }
  }

  async function handleDisconnect() {
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

      setJobs((current) => [job, ...current]);
      setFilter('All');
      setSelectedId(job.job_id);
      setNotice('');
      return;
    }

    if (input.recipient === CONTRACT_ID) {
      setNotice('The recipient cannot be the contract account itself.');
      return;
    }

    // Track the ID before sending, so the job is listed even if the
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
        setNotice(`Job "${input.jobId}" created on the contract.`);
        await refreshLiveJobs();
      } catch (error) {
        setNotice(`Creating the job failed: ${errorMessage(error)}`);
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
      setJobs((current) =>
        current.map((candidate) =>
          candidate.job_id === jobId
            ? { ...candidate, state: 'Approved' }
            : candidate,
        ),
      );
      setNotice(
        `Demo job "${jobId}" approved locally. No payment was sent.`,
      );
      return;
    }

    void (async () => {
      try {
        await callContractMethod(selector, 'approve_job', { job_id: jobId }, GAS.approve);
        setNotice(`Job "${jobId}" approved on the contract.`);
        await refreshLiveJobs();
      } catch (error) {
        setNotice(`Approving the job failed: ${errorMessage(error)}`);
      }
    })();
  }

  function handleExecute(jobId: string) {
    if (!isLive || !selector) {
      return;
    }
    void (async () => {
      try {
        await callContractMethod(selector, 'execute_job', { job_id: jobId }, GAS.execute);
        setNotice(
          `Execution sent for "${jobId}". The payment settles in a few seconds — refresh to see it paid.`,
        );
        await refreshLiveJobs();
      } catch (error) {
        setNotice(`Executing the payment failed: ${errorMessage(error)}`);
      }
    })();
  }

  async function handleTrack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = trackInput.trim();
    if (!id) {
      return;
    }
    try {
      const job = await fetchContractJob(id);
      if (!job) {
        setNotice(`No job with ID "${id}" exists on the contract.`);
        return;
      }
      trackJobId(id);
      setTrackInput('');
      setFilter('All');
      setSelectedId(id);
      setNotice(`Now tracking "${id}" from the contract.`);
      await refreshLiveJobs();
    } catch {
      setNotice('Could not look that job up. Check your connection and try again.');
    }
  }

  function openCreateDialog() {
    setIsDialogOpen(true);
  }

  function closeCreateDialog() {
    setIsDialogOpen(false);
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

  const countFor = (target: Filter) =>
    target === 'All' ? jobs.length : counts[target];

  const notOwner = isLive && ownerId !== null && ownerId !== accountId;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <div className="page">
        <header className="header">
          <div className="brand">
            <span className="brand__mark" aria-hidden="true">
              1×
            </span>
            <span className="brand__name">PayOnce</span>
          </div>
          <div className="header__actions">
            <button
              type="button"
              className="theme-toggle"
              onClick={() =>
                setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
              }
              aria-label={
                theme === 'dark'
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'
              }
              title={
                theme === 'dark'
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'
              }
            >
              {theme === 'dark' ? (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2" />
                  <path d="M12 20v2" />
                  <path d="m4.93 4.93 1.41 1.41" />
                  <path d="m17.66 17.66 1.41 1.41" />
                  <path d="M2 12h2" />
                  <path d="M20 12h2" />
                  <path d="m6.34 17.66-1.41 1.41" />
                  <path d="m19.07 4.93-1.41 1.41" />
                </svg>
              ) : (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                </svg>
              )}
            </button>
            {isLive ? (
              <>
                <span className="wallet-chip" title={accountId ?? undefined}>
                  {accountId}
                </span>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={handleDisconnect}
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                type="button"
                className="button button--primary button--connect"
                onClick={handleConnect}
              >
                <svg
                  width="17"
                  height="17"
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
                Connect wallet
              </button>
            )}
          </div>
        </header>

        {isLive && (
          <div className="demo-notice demo-notice--live" role="note">
            <span className="demo-notice__tag">Live</span>
            <p>
              <strong>Live on NEAR testnet.</strong> You are connected as{' '}
              <span className="mono">{accountId}</span> to the contract{' '}
              <span className="mono">{CONTRACT_ID}</span>. Actions send real
              testnet transactions.
              {notOwner &&
                ' This account is not the contract owner, so the contract will reject create, approve, and execute calls.'}
            </p>
          </div>
        )}

        <main id="main">
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}

          <div className="toolbar">
            <div className="toolbar__left">
              <h1 className="toolbar__title">Jobs</h1>
              <div
                className="filters"
                role="group"
                aria-label="Filter jobs by status"
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
                      {countFor(target)}
                    </span>
                    <span className="sr-only">
                      {countFor(target)} {countFor(target) === 1 ? 'job' : 'jobs'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="toolbar__actions">
              {isLive && (
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => void refreshLiveJobs()}
                  disabled={isRefreshing}
                >
                  {isRefreshing ? 'Refreshing…' : 'Refresh'}
                </button>
              )}
              <button
                type="button"
                className="button button--primary"
                onClick={openCreateDialog}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Create job
              </button>
            </div>
          </div>

          {isLive && (
            <form className="track-job" onSubmit={handleTrack}>
              <label className="track-job__label" htmlFor="track-job-id">
                Track a job by ID
              </label>
              <input
                id="track-job-id"
                className="track-job__input"
                type="text"
                value={trackInput}
                onChange={(event) => setTrackInput(event.target.value)}
                placeholder="e.g. website-redesign-01"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
              />
              <button type="submit" className="button button--secondary">
                Track job
              </button>
            </form>
          )}

          <div className="content-grid">
            <div className="content-grid__main">
              <div className="job-cards" role="list" aria-label="Jobs">
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
                  <p className="empty-state__title">No jobs in this view.</p>
                  <p>
                    {filter === 'All'
                      ? isLive
                        ? 'No tracked jobs yet. Create a job, or track an existing one by its ID above.'
                        : 'Create a demo job to get started.'
                      : `No jobs have the "${filterLabel(filter)}" status. Choose another filter or create a job.`}
                  </p>
                  {filter !== 'All' && (
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => changeFilter('All')}
                    >
                      Show all jobs
                    </button>
                  )}
                </div>
              )}
            </div>

            {selectedJob && (!isMobile || isDetailsOpen) && (
              <JobDetails
                job={selectedJob}
                onApprove={handleApprove}
                onExecute={handleExecute}
                onClose={closeDetails}
                isMobile={isMobile}
              />
            )}
          </div>
        </main>
      </div>

      <CreateJobDialog
        isOpen={isDialogOpen}
        onClose={closeCreateDialog}
        existingIds={existingIds}
        onCreate={handleCreate}
        live={isLive}
      />
    </>
  );
}
