import { useEffect, useMemo, useState } from 'react';
import { CreateJobDialog } from './components/CreateJobDialog';
import { JobCard } from './components/JobCard';
import { JobDetails } from './components/JobDetails';
import { JobTable } from './components/JobTable';
import { createFixtureJobs, FIXTURE_JOBS } from './fixtures';
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

export default function App() {
  const [jobs, setJobs] = useState<DemoJob[]>(createFixtureJobs);
  const [filter, setFilter] = useState<Filter>('All');
  const [selectedId, setSelectedId] = useState<string | null>(
    FIXTURE_JOBS[0]?.job_id ?? null,
  );
  const [notice, setNotice] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

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

  function changeFilter(nextFilter: Filter) {
    setFilter(nextFilter);
    const nextJobs = jobsForFilter(jobs, nextFilter);
    if (!nextJobs.some((job) => job.job_id === selectedId)) {
      setSelectedId(nextJobs[0]?.job_id ?? null);
      setIsDetailsOpen(false);
    }
    setNotice('');
  }

  function handleCreate(input: {
    jobId: string;
    recipient: string;
    amount: string;
  }) {
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
  }

  function handleApprove(jobId: string) {
    const job = jobs.find((candidate) => candidate.job_id === jobId);
    if (!job || job.state !== 'AwaitingApproval') {
      return;
    }

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
  }

  function handleReset() {
    setJobs(createFixtureJobs());
    setFilter('All');
    setSelectedId(FIXTURE_JOBS[0]?.job_id ?? null);
    setNotice(
      `Demo data reset to ${FIXTURE_JOBS.length} sample jobs. No transaction was sent.`,
    );
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
          <button
            type="button"
            className="button button--ghost"
            onClick={handleReset}
          >
            Reset demo data
          </button>
        </header>

        <div className="demo-notice" role="note">
          <span className="demo-notice__tag">Demo</span>
          <p>
            <strong>Demo — no real payments.</strong> Jobs and approvals live
            only in this browser tab. Refreshing resets everything.
          </p>
        </div>

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
                      ? 'Create a demo job to get started.'
                      : `No jobs have the "${filterLabel(filter)}" status. Choose another filter or create a demo job.`}
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
      />
    </>
  );
}