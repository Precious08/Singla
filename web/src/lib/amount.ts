export const YOCTO_PER_NEAR = 10n ** 24n;
export const MAX_U128 = (1n << 128n) - 1n;

const NEAR_PATTERN = /^\d+(?:\.\d+)?$/;

export type AmountParseResult =
  | { ok: true; yocto: string }
  | { ok: false; error: string };

function fail(error: string): AmountParseResult {
  return { ok: false, error };
}

/**
 * Converts a NEAR amount to yoctoNEAR using integer arithmetic only.
 * Accepts digits with an optional decimal point and at most 24 decimals.
 */
export function parseNearToYocto(raw: string): AmountParseResult {
  if (raw.length === 0) {
    return fail('Enter an amount in NEAR.');
  }
  if (/\s/.test(raw)) {
    return fail('Amount cannot contain spaces.');
  }
  if (raw.startsWith('-')) {
    return fail('Amount must be greater than zero.');
  }
  if (!NEAR_PATTERN.test(raw)) {
    return fail('Use digits and a single decimal point, for example 12.5.');
  }

  const [whole, fraction = ''] = raw.split('.');
  if (fraction.length > 24) {
    return fail('Amount cannot have more than 24 decimal places.');
  }

  const paddedFraction = (fraction + '0'.repeat(24)).slice(0, 24);
  const yocto = BigInt(whole) * YOCTO_PER_NEAR + BigInt(paddedFraction);

  if (yocto === 0n) {
    return fail('Amount must be greater than zero.');
  }
  if (yocto > MAX_U128) {
    return fail('Amount is too large for the contract.');
  }

  return { ok: true, yocto: yocto.toString() };
}

function assertYocto(yocto: string): bigint {
  if (!/^\d+$/.test(yocto)) {
    throw new Error(`Invalid yoctoNEAR amount: ${yocto}`);
  }
  return BigInt(yocto);
}

/** Formats yoctoNEAR as an exact NEAR decimal string without grouping. */
export function formatYoctoToNear(yocto: string): string {
  const value = assertYocto(yocto);
  const whole = value / YOCTO_PER_NEAR;
  const fraction = (value % YOCTO_PER_NEAR)
    .toString()
    .padStart(24, '0')
    .replace(/0+$/, '');

  return fraction.length > 0 ? `${whole.toString()}.${fraction}` : whole.toString();
}

/** Adds thousands separators to the whole-number part of a decimal string. */
export function groupWholeNumber(value: string): string {
  const [whole, fraction] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/** Formats yoctoNEAR for display, for example `1,250.5 NEAR`. */
export function formatNearAmount(yocto: string): string {
  return `${groupWholeNumber(formatYoctoToNear(yocto))} NEAR`;
}

/** Formats the exact yoctoNEAR value with grouped digits. */
export function formatYoctoExact(yocto: string): string {
  assertYocto(yocto);
  return `${groupWholeNumber(yocto)} yoctoNEAR`;
}
