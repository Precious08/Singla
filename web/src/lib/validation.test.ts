import { describe, expect, it } from 'vitest';
import {
  assembleRecipientId,
  DEMO_CONTRACT_ACCOUNT,
  normalizeRecipientName,
  RECIPIENT_SUFFIX,
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

describe('normalizeRecipientName', () => {
  it('keeps a bare name untouched', () => {
    expect(normalizeRecipientName('alice')).toBe('alice');
    expect(normalizeRecipientName('sofia.kitchen')).toBe('sofia.kitchen');
  });

  it('strips a pasted ".testnet" ending so it can never double', () => {
    expect(normalizeRecipientName('alice.testnet')).toBe('alice');
    expect(normalizeRecipientName('sofia.kitchen.testnet')).toBe(
      'sofia.kitchen',
    );
    expect(normalizeRecipientName('alice.testnet.testnet')).toBe('alice');
  });

  it('trims and lowercases whatever was typed or pasted', () => {
    expect(normalizeRecipientName('  Alice.Testnet  ')).toBe('alice');
    expect(normalizeRecipientName('SOFIA.KITCHEN')).toBe('sofia.kitchen');
  });

  it('reduces a lone ending to a blank name', () => {
    expect(normalizeRecipientName('.testnet')).toBe('');
    expect(normalizeRecipientName('')).toBe('');
  });
});

describe('assembleRecipientId', () => {
  it('appends the ending to a name', () => {
    expect(RECIPIENT_SUFFIX).toBe('.testnet');
    expect(assembleRecipientId('alice')).toBe('alice.testnet');
    expect(assembleRecipientId('sofia.kitchen')).toBe(
      'sofia.kitchen.testnet',
    );
  });

  it('keeps a blank name blank', () => {
    expect(assembleRecipientId('')).toBe('');
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
        recipient: 'alice',
        amountNear: '12.5',
      },
      noIds,
    );

    expect(result.errors).toEqual({});
    expect(result.amountYocto).toBe('12500000000000000000000000');
  });

  it('validates the assembled ID, sub-domains included', () => {
    const result = validateCreateJob(
      {
        jobId: 'new-job',
        recipient: 'sofia.kitchen',
        amountNear: '1',
      },
      noIds,
    );

    expect(result.errors).toEqual({});
  });

  it('measures the length limit against the assembled ID', () => {
    // 56 name characters + ".testnet" = 64, the longest valid account ID.
    expect(
      validateCreateJob(
        { jobId: 'ok', recipient: 'a'.repeat(56), amountNear: '1' },
        noIds,
      ).errors.recipient,
    ).toBeUndefined();
    // 57 name characters assemble to 65, one too many.
    expect(
      validateCreateJob(
        { jobId: 'ok', recipient: 'a'.repeat(57), amountNear: '1' },
        noIds,
      ).errors.recipient,
    ).toBe('Recipient must be a valid NEAR account ID (2–64 characters).');
  });

  it('rejects the demo contract account named without its ending', () => {
    const result = validateCreateJob(
      { jobId: 'ok', recipient: 'payonce-demo', amountNear: '1' },
      noIds,
    );

    expect(result.errors.recipient).toBe(
      'Recipient cannot be the contract itself.',
    );
  });

  it('rejects duplicate IDs at submit time', () => {
    const result = validateCreateJob(
      {
        jobId: 'existing-job',
        recipient: 'alice',
        amountNear: '1',
      },
      new Set(['existing-job']),
    );

    expect(result.errors.jobId).toBe('Payment ID already exists.');
    expect(result.errors.recipient).toBeUndefined();
    expect(result.errors.amountNear).toBeUndefined();
  });
});
