import { JOB_STATE_LABELS, type JobState } from '../types';

export type BadgeState = JobState | 'Failed';

const STATE_CLASS: Record<BadgeState, string> = {
  AwaitingApproval: 'status-badge--awaiting',
  Approved: 'status-badge--approved',
  PaymentPending: 'status-badge--pending',
  Paid: 'status-badge--paid',
  Failed: 'status-badge--failed',
};

const STATE_LABEL: Record<BadgeState, string> = {
  ...JOB_STATE_LABELS,
  Failed: 'Failed',
};

export function StatusBadge({ state }: { state: BadgeState }) {
  return (
    <span className={`status-badge ${STATE_CLASS[state]}`}>
      <span className="status-badge__dot" aria-hidden="true" />
      {STATE_LABEL[state]}
    </span>
  );
}
