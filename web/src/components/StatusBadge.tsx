import { JOB_STATE_LABELS, type JobState } from '../types';

const STATE_CLASS: Record<JobState, string> = {
  AwaitingApproval: 'status-badge--awaiting',
  Approved: 'status-badge--approved',
  PaymentPending: 'status-badge--pending',
  Paid: 'status-badge--paid',
};

export function StatusBadge({ state }: { state: JobState }) {
  return (
    <span className={`status-badge ${STATE_CLASS[state]}`}>
      <span className="status-badge__dot" aria-hidden="true" />
      {JOB_STATE_LABELS[state]}
    </span>
  );
}
