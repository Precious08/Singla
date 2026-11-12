import { formatNearAmount } from '../lib/amount';
import type { DemoJob } from '../types';
import { StatusBadge } from './StatusBadge';

interface JobCardProps {
  job: DemoJob;
  selected: boolean;
  onSelect: (jobId: string) => void;
}

export function JobCard({ job, selected, onSelect }: JobCardProps) {
  return (
    <article
      className={`job-card${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect(job.job_id)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(job.job_id);
        }
      }}
      aria-current={selected ? 'true' : undefined}
    >
      <div className="job-card__header">
        <span className="job-card__id">{job.job_id}</span>
        <span className="job-card__status">
          <StatusBadge state={job.state} />
        </span>
      </div>
      <div className="job-card__meta">
        <span className="job-card__recipient">
          <span className="mono">{job.recipient}</span>
        </span>
        <span className="job-card__amount">{formatNearAmount(job.amount)}</span>
      </div>
      <span className="job-card__chevron" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 6 6 6-6 6" />
        </svg>
      </span>
    </article>
  );
}