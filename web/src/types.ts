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
}

export const JOB_STATE_LABELS: Record<JobState, string> = {
  AwaitingApproval: 'Awaiting approval',
  Approved: 'Approved',
  PaymentPending: 'Payment pending',
  Paid: 'Paid',
};
