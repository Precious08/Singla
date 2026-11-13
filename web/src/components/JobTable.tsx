import { formatNearAmount } from '../lib/amount';
import type { DemoJob } from '../types';
import { StatusBadge } from './StatusBadge';

interface JobTableProps {
  jobs: readonly DemoJob[];
  selectedId: string | null;
  onSelect: (jobId: string) => void;
}

export function JobTable({ jobs, selectedId, onSelect }: JobTableProps) {
  if (jobs.length === 0) {
    return null;
  }

  return (
    <div className="table-container" role="region" aria-label="Payments table" tabIndex={0}>
      <table className="job-table">
        <thead>
          <tr>
            <th scope="col">Payment ID</th>
            <th scope="col">Recipient</th>
            <th scope="col">Amount</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr
              key={job.job_id}
              className={job.job_id === selectedId ? 'is-selected' : ''}
              onClick={() => onSelect(job.job_id)}
            >
              <td className="job-table__id">
                <button
                  type="button"
                  className="job-table__select"
                  onClick={() => onSelect(job.job_id)}
                  aria-pressed={job.job_id === selectedId}
                  aria-label={`Select payment ${job.job_id}`}
                >
                  {job.job_id}
                </button>
              </td>
              <td className="job-table__recipient">
                <span className="mono">{job.recipient}</span>
              </td>
              <td className="job-table__amount">
                {formatNearAmount(job.amount)}
              </td>
              <td>
                <StatusBadge state={job.failed ? 'Failed' : job.state} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}