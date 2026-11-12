import { useState } from 'react';
import { formatNearAmount, formatYoctoExact } from '../lib/amount';
import { JOB_STATE_LABELS, type DemoJob, type JobState } from '../types';
import { StatusBadge } from './StatusBadge';

interface JobDetailsProps {
  job: DemoJob;
  onApprove: (jobId: string) => void;
  onClose?: () => void;
  isMobile?: boolean;
}

const STATE_NOTES: Record<JobState, string> = {
  AwaitingApproval:
    'This job is awaiting approval. Approving only updates this local demo — no payment is scheduled or sent.',
  Approved:
    'This job is approved. Payment execution is not available in this demo.',
  PaymentPending:
    'This job is marked payment pending. No transfer was started in this demo.',
  Paid:
    'This job is marked paid. No on-chain payment occurred in this demo.',
};

function blockedApprovalLabel(state: JobState): string {
  switch (state) {
    case 'Approved':
      return 'Already approved';
    case 'PaymentPending':
      return 'Approval blocked — payment pending';
    case 'Paid':
      return 'Approval blocked — already paid';
    case 'AwaitingApproval':
      return 'Approve job';
  }
}

function approvalHint(state: JobState): string {
  switch (state) {
    case 'Approved':
      return 'Approved jobs are not approved again in this demo.';
    case 'PaymentPending':
      return 'A payment is already pending, so approval is blocked.';
    case 'Paid':
      return 'A paid job is final, so approval is blocked.';
    case 'AwaitingApproval':
      return '';
  }
}

export function JobDetails({ job, onApprove, onClose, isMobile = false }: JobDetailsProps) {
  const canApprove = job.state === 'AwaitingApproval';
  const [showYocto, setShowYocto] = useState(false);

  return (
    <section
      className="details-panel"
      aria-labelledby="details-heading"
    >
      {isMobile ? (
        <div className="details-panel__header-mobile">
          <button
            type="button"
            className="details-panel__back"
            onClick={onClose}
            aria-label="Back to jobs"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="details-panel__title">
            <h2 id="details-heading" className="details-panel__heading">
              Job details
            </h2>
          </div>
          <StatusBadge state={job.state} />
        </div>
      ) : (
        <div className="details-panel__header">
          <div className="details-panel__title">
            <h2 id="details-heading" className="details-panel__heading">
              Job details
            </h2>
          </div>
          <StatusBadge state={job.state} />
        </div>
      )}

      <div className="details-panel__body">
        <div className="details-panel__grid">
          <div className="details-panel__row">
            <dt className="details-panel__label">Job ID</dt>
            <dd className="details-panel__value details-panel__value--mono break">
              {job.job_id}
            </dd>
          </div>

          <div className="details-panel__row">
            <dt className="details-panel__label">Recipient</dt>
            <dd className="details-panel__value details-panel__value--mono break">
              {job.recipient}
            </dd>
          </div>

          <div className="details-panel__row">
            <dt className="details-panel__label">Amount</dt>
            <dd>
              <span className="details-panel__amount">
                {formatNearAmount(job.amount)}
              </span>
              <button
                type="button"
                className="details-panel__expand"
                aria-expanded={showYocto}
                onClick={() => setShowYocto(!showYocto)}
                aria-controls="yocto-details"
              >
                <span>{showYocto ? 'Hide' : 'Show'} yoctoNEAR</span>
                <svg
                  className="details-panel__expand-icon"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              <p
                id="yocto-details"
                className="details-panel__yocto mono"
                hidden={!showYocto}
              >
                {formatYoctoExact(job.amount)}
              </p>
            </dd>
          </div>

          <div className="details-panel__row">
            <dt className="details-panel__label">Status</dt>
            <dd className="details-panel__value">
              {JOB_STATE_LABELS[job.state]}
            </dd>
          </div>

          <div className="details-panel__row">
            <dt className="details-panel__label">Source</dt>
            <dd className="details-panel__value">
              {job.source === 'fixture'
                ? 'Sample fixture — not live contract state'
                : 'Created locally in this session'}
            </dd>
          </div>
        </div>

        <p className="details-panel__state-note">{STATE_NOTES[job.state]}</p>

        <div className="details-panel__actions">
          <div className="details-panel__action-row">
            <button
              type="button"
              className="button button--primary details-panel__button"
              disabled={!canApprove}
              onClick={() => onApprove(job.job_id)}
            >
              {blockedApprovalLabel(job.state)}
            </button>
          </div>
          {!canApprove && (
            <p className="details-panel__disabled-hint">
              {approvalHint(job.state)}
            </p>
          )}

          <div className="details-panel__action-row details-panel__action-row--single">
            <button
              type="button"
              className="button button--secondary details-panel__button"
              disabled
              aria-describedby="execute-note"
            >
              Execute payment
            </button>
            <p id="execute-note" className="details-panel__disabled-hint">
              Payment execution is unavailable in this demo. It requires the testnet
              contract and wallet-signed transactions.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}