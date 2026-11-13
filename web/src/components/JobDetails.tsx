import { useState } from 'react';
import { formatNearAmount, formatYoctoExact } from '../lib/amount';
import { type DemoJob, type JobState } from '../types';
import { StatusBadge } from './StatusBadge';

export type DetailsMode = 'live' | 'try';

interface JobDetailsProps {
  job: DemoJob;
  mode: DetailsMode;
  onApprove: (jobId: string) => void;
  onExecute: (jobId: string) => void;
  onClose?: () => void;
  isMobile?: boolean;
  /** Try mode only: the visitor pressed "Pay it again" on a paid payment. */
  onPayAgain?: () => void;
}

const LIVE_NOTES: Record<JobState, string> = {
  AwaitingApproval:
    'This payment is live on the contract and awaiting approval. Approving sends a real transaction.',
  Approved:
    'This payment is approved on the contract. Executing sends the payment from the contract to the recipient.',
  PaymentPending:
    'A payment for this one is in flight on-chain. It settles within seconds. Refresh to see the outcome.',
  Paid: 'This payment is paid. The transfer is final and cannot be repeated.',
};

const TRY_NOTES: Record<JobState, string> = {
  AwaitingApproval: 'Written and waiting. Nothing moves until you approve it.',
  Approved:
    'Approved in your browser. Execute it and the pretend payment moves.',
  PaymentPending:
    'Sending the pretend payment. It lands in a second or two.',
  Paid: 'Paid with pretend money. The loop is complete.',
};

const FAILED_NOTE_TEXT =
  'The send failed. No money moved. This payment is still approved, so you can send it again.';

const EXEC_NOTES: Record<DetailsMode, Record<JobState, string>> = {
  live: {
    AwaitingApproval: 'Approve the payment first, then execute it.',
    Approved:
      'Sends the payment from the contract to the recipient. Your wallet will ask you to approve the transaction.',
    PaymentPending: 'A payment is already in flight.',
    Paid: 'This payment is already paid. The contract will never pay it twice.',
  },
  try: {
    AwaitingApproval: 'Approve the payment first, then execute it.',
    Approved:
      'Sends the pretend payment from this browser. It lands in about two seconds.',
    PaymentPending: 'A payment is already on its way.',
    Paid: 'This payment is already paid. Singla never pays twice.',
  },
};

const FAILED_EXEC_NOTE =
  'Sends the payment again. Your wallet will ask you to approve the transaction.';

export function JobDetails({
  job,
  mode,
  onApprove,
  onExecute,
  onClose,
  isMobile = false,
  onPayAgain,
}: JobDetailsProps) {
  const [showYocto, setShowYocto] = useState(false);
  const [refused, setRefused] = useState(false);

  const failed = Boolean(job.failed);
  const canApprove = job.state === 'AwaitingApproval';
  const canExecute = failed || job.state === 'Approved';
  const showExecuteSlot = !canApprove;
  const stateNote = failed
    ? FAILED_NOTE_TEXT
    : mode === 'live'
      ? LIVE_NOTES[job.state]
      : TRY_NOTES[job.state];
  const execNote = failed ? FAILED_EXEC_NOTE : EXEC_NOTES[mode][job.state];
  const showPayAgain = mode === 'try' && job.state === 'Paid' && !failed;

  const badge = <StatusBadge state={failed ? 'Failed' : job.state} />;

  return (
    <section className="details-panel" aria-labelledby="details-heading">
      {isMobile ? (
        <div className="details-panel__header-mobile">
          <button
            type="button"
            className="details-panel__back"
            onClick={onClose}
            aria-label="Back to payments"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="details-panel__title">
            <h2 id="details-heading" className="details-panel__heading">
              Payment details
            </h2>
          </div>
          {badge}
        </div>
      ) : (
        <div className="details-panel__header">
          <div className="details-panel__title">
            <h2 id="details-heading" className="details-panel__heading">
              Payment details
            </h2>
          </div>
          {badge}
        </div>
      )}

      <div className="details-panel__body">
        <div className="details-panel__grid">
          <div className="details-panel__row">
            <dt className="details-panel__label">Payment ID</dt>
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
        </div>

        <p className="details-panel__state-note">{stateNote}</p>

        <div className="details-panel__actions">
          {canApprove ? (
            <div className="details-panel__action-row">
              <button
                type="button"
                className="button button--primary details-panel__button"
                onClick={() => onApprove(job.job_id)}
              >
                Approve payment
              </button>
            </div>
          ) : (
            <>
              <div className="details-panel__action-row">
                <span className="settled-pill details-panel__button">
                  <span aria-hidden="true">✓</span> Approved
                </span>
              </div>

              {showExecuteSlot && (
                <div className="details-panel__action-row details-panel__action-row--single">
                  <button
                    type="button"
                    className={`button details-panel__button ${
                      canExecute ? 'button--primary' : 'button--secondary'
                    }`}
                    disabled={!canExecute}
                    aria-describedby="execute-note"
                    onClick={() => onExecute(job.job_id)}
                  >
                    {failed ? 'Send again' : 'Execute payment'}
                  </button>
                  <p
                    id="execute-note"
                    className="details-panel__disabled-hint"
                  >
                    {execNote}
                  </p>
                </div>
              )}
            </>
          )}

          {showPayAgain && (
            <div className="try-again">
              <button
                type="button"
                className="button button--secondary try-again__button"
                onClick={() => {
                  setRefused(true);
                  onPayAgain?.();
                }}
              >
                Pay it again
              </button>
              {refused && (
                <div className="refused-stamp" role="status">
                  <b>Refused</b>
                  <span>Already paid. Singla never pays twice.</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
