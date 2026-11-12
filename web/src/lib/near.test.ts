import { beforeEach, describe, expect, it } from 'vitest';
import {
  chainJobToDemoJob,
  loadTrackedJobIds,
  saveTrackedJobIds,
  trackJobId,
} from './near';

describe('chainJobToDemoJob', () => {
  it('maps a valid contract job', () => {
    expect(
      chainJobToDemoJob({
        job_id: 'job-1',
        recipient: 'someone.testnet',
        amount: '12500000000000000000000000',
        state: 'Approved',
      }),
    ).toEqual({
      job_id: 'job-1',
      recipient: 'someone.testnet',
      amount: '12500000000000000000000000',
      state: 'Approved',
      source: 'chain',
    });
  });

  it('rejects unknown states and malformed values', () => {
    expect(chainJobToDemoJob(null)).toBeNull();
    expect(chainJobToDemoJob('job')).toBeNull();
    expect(
      chainJobToDemoJob({
        job_id: 'job-1',
        recipient: 'someone.testnet',
        amount: '1',
        state: 'Deleted',
      }),
    ).toBeNull();
    expect(
      chainJobToDemoJob({ job_id: 'job-1', recipient: 'someone.testnet', amount: 5, state: 'Paid' }),
    ).toBeNull();
  });
});

describe('tracked job ID registry', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts empty and round-trips saved IDs', () => {
    expect(loadTrackedJobIds()).toEqual([]);
    saveTrackedJobIds(['a', 'b']);
    expect(loadTrackedJobIds()).toEqual(['a', 'b']);
  });

  it('tracks new IDs newest-first without duplicates', () => {
    expect(trackJobId('first')).toEqual(['first']);
    expect(trackJobId('second')).toEqual(['second', 'first']);
    expect(trackJobId('first')).toEqual(['second', 'first']);
  });

  it('survives corrupt stored values', () => {
    window.localStorage.setItem('payonce:tracked-job-ids', '{broken');
    expect(loadTrackedJobIds()).toEqual([]);
    window.localStorage.setItem('payonce:tracked-job-ids', '{"not":"an array"}');
    expect(loadTrackedJobIds()).toEqual([]);
  });
});
