export const JOB_STATES = [
  'AwaitingApproval',
  'Approved',
  'PaymentPending',
  'Paid',
] as const;

export type JobState = (typeof JOB_STATES)[number];

export interface Job {
  job_id: string;
  recipient: string;
  /** Amount in yoctoNEAR as a decimal string, matching the contract's U128 JSON shape. */
  amount: string;
  state: JobState;
}

export type JobSource = 'fixture' | 'local' | 'chain';

export interface DemoJob extends Job {
  source: JobSource;
  /**
   * Display-only flag: the last live send for this payment failed. The
   * contract has no failed state (a failed send returns the job to
   * Approved), so the app remembers the failure locally and shows the
   * payment as Failed until it is sent again.
   */
  failed?: boolean;
}

export const JOB_STATE_LABELS: Record<JobState, string> = {
  AwaitingApproval: 'Awaiting approval',
  Approved: 'Approved',
  PaymentPending: 'Payment pending',
  Paid: 'Paid',
};
