import { parseNearToYocto } from './amount';

export const MAX_JOB_ID_BYTES = 64;
export const DEMO_CONTRACT_ACCOUNT = 'payonce-demo.testnet';

const ACCOUNT_ID_PATTERN =
  /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export interface CreateJobValues {
  jobId: string;
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
    return 'Job ID cannot be blank.';
  }
  if (utf8ByteLength(jobId) > MAX_JOB_ID_BYTES) {
    return 'Job ID cannot exceed 64 bytes.';
  }
  if (existingIds.has(jobId)) {
    return 'Job ID already exists.';
  }
  return undefined;
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

  const recipientError = validateRecipient(values.recipient);
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
