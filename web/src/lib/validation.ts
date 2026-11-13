import { parseNearToYocto } from './amount';

export const MAX_JOB_ID_BYTES = 64;
export const DEMO_CONTRACT_ACCOUNT = 'payonce-demo.testnet';

/** The ending every recipient account carries. The create form shows it
 * inside the field; the sender types only the name before it. */
export const RECIPIENT_SUFFIX = '.testnet';

const ACCOUNT_ID_PATTERN =
  /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export interface CreateJobValues {
  jobId: string;
  /** The recipient's account name only, without the ".testnet" ending. */
  recipient: string;
  amountNear: string;
}

export interface CreateJobErrors {
  jobId?: string;
  recipient?: string;
  amountNear?: string;
}

export interface CreateJobValidation {
  errors: CreateJobErrors;
  amountYocto?: string;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function validateJobId(
  jobId: string,
  existingIds: ReadonlySet<string>,
): string | undefined {
  if (jobId.trim().length === 0) {
    return 'Payment ID cannot be blank.';
  }
  if (utf8ByteLength(jobId) > MAX_JOB_ID_BYTES) {
    return 'Payment ID cannot exceed 64 bytes.';
  }
  if (existingIds.has(jobId)) {
    return 'Payment ID already exists.';
  }
  return undefined;
}

/**
 * Arrange whatever lands in the recipient field into the bare account
 * name: trimmed, lowercased, and with the ".testnet" ending removed, so
 * pasting a full address can never double the ending. Sub-domains the
 * sender typed (e.g. "sofia.kitchen") stay exactly as typed.
 */
export function normalizeRecipientName(raw: string): string {
  let name = raw.trim().toLowerCase();
  while (name.endsWith(RECIPIENT_SUFFIX)) {
    name = name.slice(0, -RECIPIENT_SUFFIX.length);
  }
  return name;
}

/** The full account ID a typed name stands for. A blank name stays blank,
 * so validation still reports it as missing rather than as ".testnet". */
export function assembleRecipientId(name: string): string {
  return name.length === 0 ? '' : `${name}${RECIPIENT_SUFFIX}`;
}

export function validateRecipient(recipient: string): string | undefined {
  if (recipient.length === 0) {
    return 'Enter a recipient account.';
  }
  if (
    recipient.length < 2 ||
    recipient.length > 64 ||
    !ACCOUNT_ID_PATTERN.test(recipient)
  ) {
    return 'Recipient must be a valid NEAR account ID (2–64 characters).';
  }
  if (recipient === DEMO_CONTRACT_ACCOUNT) {
    return 'Recipient cannot be the contract itself.';
  }
  return undefined;
}

export function validateCreateJob(
  values: CreateJobValues,
  existingIds: ReadonlySet<string>,
): CreateJobValidation {
  const errors: CreateJobErrors = {};

  const jobIdError = validateJobId(values.jobId, existingIds);
  if (jobIdError) {
    errors.jobId = jobIdError;
  }

  const recipientError = validateRecipient(
    assembleRecipientId(values.recipient),
  );
  if (recipientError) {
    errors.recipient = recipientError;
  }

  const amount = parseNearToYocto(values.amountNear);
  if (!amount.ok) {
    errors.amountNear = amount.error;
  }

  return {
    errors,
    amountYocto: amount.ok ? amount.yocto : undefined,
  };
}
