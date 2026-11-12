import { describe, expect, it } from 'vitest';
import { FIXTURE_JOBS } from './fixtures';
import { JOB_STATES } from './types';

describe('fixtures', () => {
  it('labels every contract state', () => {
    const states = new Set(FIXTURE_JOBS.map((job) => job.state));
    expect(states).toEqual(new Set(JOB_STATES));
  });

  it('uses unique IDs and exact positive yoctoNEAR strings', () => {
    const ids = new Set(FIXTURE_JOBS.map((job) => job.job_id));
    expect(ids.size).toBe(FIXTURE_JOBS.length);

    for (const job of FIXTURE_JOBS) {
      expect(job.amount).toMatch(/^\d+$/);
      expect(BigInt(job.amount) > 0n).toBe(true);
      expect(job.source).toBe('fixture');
    }
  });
});
