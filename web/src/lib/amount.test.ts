import { describe, expect, it } from 'vitest';
import {
  formatNearAmount,
  formatYoctoExact,
  formatYoctoToNear,
  groupWholeNumber,
  parseNearToYocto,
} from './amount';

function expectYocto(input: string, expected: string) {
  expect(parseNearToYocto(input)).toEqual({ ok: true, yocto: expected });
}

function expectError(input: string, message: string) {
  expect(parseNearToYocto(input)).toEqual({ ok: false, error: message });
}

describe('parseNearToYocto', () => {
  it('converts whole and fractional NEAR exactly', () => {
    expectYocto('1', '1000000000000000000000000');
    expectYocto('12.5', '12500000000000000000000000');
    expectYocto('0.000001', '1000000000000000000');
    expectYocto('0.000000000000000000000001', '1');
    expectYocto('0001.50', '1500000000000000000000000');
  });

  it('accepts the maximum u128 amount and rejects one yoctoNEAR above it', () => {
    expectYocto(
      '340282366920938.463463374607431768211455',
      '340282366920938463463374607431768211455',
    );
    expectError(
      '340282366920938.463463374607431768211456',
      'Amount is too large for the contract.',
    );
  });

  it('rejects blank, whitespace, signs, exponents, separators, and malformed decimals', () => {
    expectError('', 'Enter an amount in NEAR.');
    expectError('   ', 'Amount cannot contain spaces.');
    expectError(' 1', 'Amount cannot contain spaces.');
    expectError('1 ', 'Amount cannot contain spaces.');
    expectError('-1', 'Amount must be greater than zero.');
    expectError('+1', 'Use digits and a single decimal point, for example 12.5.');
    expectError('1e3', 'Use digits and a single decimal point, for example 12.5.');
    expectError('1,000', 'Use digits and a single decimal point, for example 12.5.');
    expectError('.5', 'Use digits and a single decimal point, for example 12.5.');
    expectError('1.', 'Use digits and a single decimal point, for example 12.5.');
    expectError('1..2', 'Use digits and a single decimal point, for example 12.5.');
    expectError('NaN', 'Use digits and a single decimal point, for example 12.5.');
  });

  it('rejects zero and more than 24 decimal places', () => {
    expectError('0', 'Amount must be greater than zero.');
    expectError('0.000000000000000000000000', 'Amount must be greater than zero.');
    expectError(
      '1.0000000000000000000000001',
      'Amount cannot have more than 24 decimal places.',
    );
  });
});

describe('formatting yoctoNEAR', () => {
  it('formats exact NEAR strings without floating-point rounding', () => {
    expect(formatYoctoToNear('12500000000000000000000000')).toBe('12.5');
    expect(formatYoctoToNear('100000000000000000000000000')).toBe('100');
    expect(formatYoctoToNear('1')).toBe('0.000000000000000000000001');
    expect(formatYoctoToNear('0')).toBe('0');
  });

  it('groups whole digits for display', () => {
    expect(groupWholeNumber('1234567.89')).toBe('1,234,567.89');
    expect(formatNearAmount('48000000000000000000000000')).toBe('48 NEAR');
    expect(formatNearAmount('1234500000000000000000000000')).toBe(
      '1,234.5 NEAR',
    );
    expect(formatYoctoExact('12500000000000000000000000')).toBe(
      '12,500,000,000,000,000,000,000,000 yoctoNEAR',
    );
  });

  it('rejects non-decimal yoctoNEAR strings', () => {
    expect(() => formatYoctoToNear('-1')).toThrow('Invalid yoctoNEAR amount');
    expect(() => formatYoctoToNear('1.5')).toThrow('Invalid yoctoNEAR amount');
  });
});
