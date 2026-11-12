import type { DemoJob } from './types';

/**
 * Sample jobs covering every contract state. `amount` is an exact yoctoNEAR
 * string, not a floating-point number.
 */
export const FIXTURE_JOBS: readonly DemoJob[] = [
  {
    job_id: 'demo-awaiting-1042',
    recipient: 'demo-designer.testnet',
    amount: '12500000000000000000000000',
    state: 'AwaitingApproval',
    source: 'fixture',
  },
  {
    job_id: 'demo-approved-208',
    recipient: 'demo-studio.testnet',
    amount: '48000000000000000000000000',
    state: 'Approved',
    source: 'fixture',
  },
  {
    job_id: 'demo-pending-311',
    recipient: 'demo-contractor.testnet',
    amount: '3250000000000000000000000',
    state: 'PaymentPending',
    source: 'fixture',
  },
  {
    job_id: 'demo-paid-407',
    recipient: 'demo-auditor.testnet',
    amount: '100000000000000000000000000',
    state: 'Paid',
    source: 'fixture',
  },
];

export function createFixtureJobs(): DemoJob[] {
  return FIXTURE_JOBS.map((job) => ({ ...job }));
}
