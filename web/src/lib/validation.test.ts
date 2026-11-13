import { describe, expect, it } from 'vitest';
import {
  DEMO_CONTRACT_ACCOUNT,
  validateCreateJob,
  validateJobId,
  validateRecipient,
} from './validation';

const noIds = new Set<string>();

describe('validateJobId', () => {
  it('accepts a non-blank, unique ID within 64 UTF-8 bytes', () => {
    expect(validateJobId('demo-123', noIds)).toBeUndefined();
    expect(validateJobId('a'.repeat(64), noIds)).toBeUndefined();
    expect(validateJobId('é'.repeat(32), noIds)).toBeUndefined();
  });

  it('rejects blank IDs', () => {
    expect(validateJobId('', noIds)).toBe('Payment ID cannot be blank.');
    expect(validateJobId('   ', noIds)).toBe('Payment ID cannot be blank.');
  });

  it('counts bytes, not characters, for the 64-byte limit', () => {
    expect(validateJobId('a'.repeat(65), noIds)).toBe(
      'Payment ID cannot exceed 64 bytes.',
    );
    expect(validateJobId('é'.repeat(33), noIds)).toBe(
      'Payment ID cannot exceed 64 bytes.',
    );
  });

  it('rejects duplicate IDs', () => {
    expect(validateJobId('job-1', new Set(['job-1']))).toBe(
      'Payment ID already exists.',
    );
  });
});

describe('validateRecipient', () => {
  it('accepts valid NEAR account IDs', () => {
    expect(validateRecipient('alice.testnet')).toBeUndefined();
    expect(validateRecipient('demo-designer.testnet')).toBeUndefined();
    expect(validateRecipient('alice_testnet')).toBeUndefined();
    expect(validateRecipient('alice-testnet')).toBeUndefined();
    expect(validateRecipient('a'.repeat(64))).toBeUndefined();
  });

  it('rejects malformed or out-of-range account IDs', () => {
    expect(validateRecipient('')).toBe('Enter a recipient account.');
    expect(validateRecipient('a')).toBe(
      'Recipient must be a valid NEAR account ID (2–64 characters).',
    );
    expect(validateRecipient('a'.repeat(65))).toBe(
      'Recipient must be a valid NEAR account ID (2–64 characters).',
    );
    expect(validateRecipient('Alice.testnet')).toBe(
      'Recipient must be a valid NEAR account ID (2–64 characters).',
    );
    expect(validateRecipient('alice..testnet')).toBe(
      'Recipient must be a valid NEAR account ID (2–64 characters).',
    );
    expect(validateRecipient('-alice')).toBe(
      'Recipient must be a valid NEAR account ID (2–64 characters).',
    );
    expect(validateRecipient('alice@testnet')).toBe(
      'Recipient must be a valid NEAR account ID (2–64 characters).',
    );
  });

  it('rejects the demo contract account', () => {
    expect(DEMO_CONTRACT_ACCOUNT).toBe('payonce-demo.testnet');
    expect(validateRecipient(DEMO_CONTRACT_ACCOUNT)).toBe(
      'Recipient cannot be the contract itself.',
    );
  });
});

describe('validateCreateJob', () => {
  it('collects errors for every invalid field', () => {
    const result = validateCreateJob(
      { jobId: '', recipient: '', amountNear: '' },
      noIds,
    );

    expect(result.errors).toEqual({
      jobId: 'Payment ID cannot be blank.',
      recipient: 'Enter a recipient account.',
      amountNear: 'Enter an amount in NEAR.',
    });
    expect(result.amountYocto).toBeUndefined();
  });

  it('returns exact yoctoNEAR for valid values', () => {
    const result = validateCreateJob(
      {
        jobId: 'new-job',
        recipient: 'alice.testnet',
        amountNear: '12.5',
      },
      noIds,
    );

    expect(result.errors).toEqual({});
    expect(result.amountYocto).toBe('12500000000000000000000000');
  });

  it('rejects duplicate IDs at submit time', () => {
    const result = validateCreateJob(
      {
        jobId: 'existing-job',
        recipient: 'alice.testnet',
        amountNear: '1',
      },
      new Set(['existing-job']),
    );

    expect(result.errors.jobId).toBe('Payment ID already exists.');
    expect(result.errors.recipient).toBeUndefined();
    expect(result.errors.amountNear).toBeUndefined();
  });
});
