import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Dialog } from './Dialog';
import { Toast } from './Toast';
import {
  assembleRecipientId,
  normalizeRecipientName,
  RECIPIENT_SUFFIX,
  validateCreateJob,
  validateRecipient,
  type CreateJobErrors,
  type CreateJobValues,
} from '../lib/validation';

interface CreateJobDialogProps {
  isOpen: boolean;
  onClose: () => void;
  existingIds: ReadonlySet<string>;
  onCreate: (job: {
    jobId: string;
    recipient: string;
    amount: string;
  }) => void;
  mode?: 'live' | 'try';
}

const EMPTY_VALUES: CreateJobValues = {
  jobId: '',
  recipient: '',
  amountNear: '',
};

type FieldName = keyof CreateJobValues;

const RECIPIENT_PLACEHOLDER = 'sofia.kitchen';
const RECIPIENT_CHECK_DEBOUNCE_MS = 500;
const NEAR_RPC_URL = 'https://rpc.testnet.near.org';
export const RECIPIENT_MISSING_MESSAGE = 'This account does not exist.';

type AccountExistence = 'exists' | 'missing' | 'unknown';

type RecipientCheck =
  | { status: 'idle' }
  | { status: 'pending'; accountId: string }
  | { status: 'exists'; accountId: string }
  | { status: 'missing'; accountId: string }
  | { status: 'unknown'; accountId: string };

/**
 * Ask the chain whether an account exists. Only a definite UNKNOWN_ACCOUNT
 * answer counts as "missing": a network or RPC failure stays "unknown",
 * and unknown never blocks a payment.
 */
async function checkAccountExists(
  accountId: string,
): Promise<AccountExistence> {
  try {
    const response = await fetch(NEAR_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'singla-recipient-check',
        method: 'query',
        params: {
          request_type: 'view_account',
          finality: 'optimistic',
          account_id: accountId,
        },
      }),
    });
    if (!response.ok) {
      return 'unknown';
    }
    const body = (await response.json()) as {
      result?: unknown;
      error?: { cause?: { name?: string }; data?: unknown };
    };
    if (body.result) {
      return 'exists';
    }
    if (
      body.error?.cause?.name === 'UNKNOWN_ACCOUNT' ||
      (typeof body.error?.data === 'string' &&
        body.error.data.includes('UNKNOWN_ACCOUNT'))
    ) {
      return 'missing';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export function CreateJobDialog({
  isOpen,
  onClose,
  existingIds,
  onCreate,
  mode = 'try',
}: CreateJobDialogProps) {
  const [values, setValues] = useState<CreateJobValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<CreateJobErrors>({});
  const [recipientCheck, setRecipientCheck] = useState<RecipientCheck>({
    status: 'idle',
  });
  const [dialogToast, setDialogToast] = useState<{
    key: number;
    message: string;
  } | null>(null);
  const jobIdRef = useRef<HTMLInputElement>(null);
  const recipientRef = useRef<HTMLInputElement>(null);
  const recipientMeasureRef = useRef<HTMLSpanElement>(null);
  const [recipientWidth, setRecipientWidth] = useState<number | undefined>(
    undefined,
  );
  const amountRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const checkSeq = useRef(0);
  const warnedFor = useRef<string | null>(null);
  const toastSeq = useRef(0);

  const dismissDialogToast = useCallback(() => setDialogToast(null), []);

  const fireMissingWarning = useCallback(() => {
    toastSeq.current += 1;
    setDialogToast({
      key: toastSeq.current,
      message: RECIPIENT_MISSING_MESSAGE,
    });
  }, []);

  useEffect(() => {
    if (isOpen) {
      setValues(EMPTY_VALUES);
      setErrors({});
      // Any check still in flight belongs to the previous visit.
      checkSeq.current += 1;
      warnedFor.current = null;
      setRecipientCheck({ status: 'idle' });
      setDialogToast(null);
      requestAnimationFrame(() => {
        jobIdRef.current?.focus();
      });
    }
  }, [isOpen]);

  const recipientId = assembleRecipientId(values.recipient);
  const recipientMissing =
    mode === 'live' &&
    recipientCheck.status === 'missing' &&
    recipientCheck.accountId === recipientId;
  const recipientInvalid = Boolean(errors.recipient) || recipientMissing;

  // Live mode only: while the sender types, quietly ask the chain whether
  // the assembled account exists. A name that matches nobody turns the
  // field red and floats the warning, before any money moves.
  useEffect(() => {
    if (!isOpen || mode !== 'live') {
      return;
    }
    const accountId = assembleRecipientId(values.recipient);
    if (
      values.recipient.length === 0 ||
      validateRecipient(accountId) !== undefined
    ) {
      setRecipientCheck({ status: 'idle' });
      return;
    }
    setRecipientCheck({ status: 'pending', accountId });
    const seq = ++checkSeq.current;
    const timer = setTimeout(() => {
      void checkAccountExists(accountId).then((existence) => {
        if (checkSeq.current !== seq) {
          return;
        }
        if (existence === 'exists') {
          setRecipientCheck({ status: 'exists', accountId });
        } else if (existence === 'missing') {
          setRecipientCheck({ status: 'missing', accountId });
          if (warnedFor.current !== accountId) {
            warnedFor.current = accountId;
            fireMissingWarning();
          }
        } else {
          setRecipientCheck({ status: 'unknown', accountId });
        }
      });
    }, RECIPIENT_CHECK_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [isOpen, mode, values.recipient, fireMissingWarning]);

  // Size the name input to its text (or its placeholder), so the
  // ".testnet" suffix sits immediately after the last character.
  useLayoutEffect(() => {
    const node = recipientMeasureRef.current;
    if (node) {
      setRecipientWidth(node.offsetWidth);
    }
  }, [values.recipient, isOpen]);

  function updateField(field: FieldName, value: string) {
    // The recipient field stores the bare name only: whatever is typed or
    // pasted is arranged (trimmed, lowercased, ending removed), so the
    // ending shown in the box can never double up.
    const nextValue =
      field === 'recipient' ? normalizeRecipientName(value) : value;
    setValues((current) => ({ ...current, [field]: nextValue }));
    if (errors[field]) {
      setErrors((current) => {
        const next = { ...current };
        delete next[field];
        return next;
      });
    }
  }

  function handleBlur(field: FieldName) {
    if (values[field].length === 0) {
      return;
    }
    const result = validateCreateJob(values, existingIds);
    setErrors((current) => {
      const next = { ...current };
      if (result.errors[field]) {
        next[field] = result.errors[field];
      } else {
        delete next[field];
      }
      return next;
    });
  }

  function focusFirstError(nextErrors: CreateJobErrors) {
    requestAnimationFrame(() => {
      if (nextErrors.jobId) {
        jobIdRef.current?.focus();
      } else if (nextErrors.recipient) {
        recipientRef.current?.focus();
      } else if (nextErrors.amountNear) {
        amountRef.current?.focus();
      }
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateCreateJob(values, existingIds);

    if (!result.amountYocto || Object.keys(result.errors).length > 0) {
      setErrors(result.errors);
      focusFirstError(result.errors);
      return;
    }

    const recipient = assembleRecipientId(values.recipient);

    if (mode === 'live') {
      // A definite "no such account" answer blocks creation: the warning
      // floats again, the field stays red, and nothing is sent. A check
      // that is still pending, or a lookup that failed, gets one final
      // try here; only a definite answer blocks.
      let existence: AccountExistence | null = null;
      if (
        recipientCheck.status === 'missing' &&
        recipientCheck.accountId === recipient
      ) {
        existence = 'missing';
      } else if (
        recipientCheck.status === 'exists' &&
        recipientCheck.accountId === recipient
      ) {
        existence = 'exists';
      }
      if (existence === null) {
        existence = await checkAccountExists(recipient);
        if (existence === 'missing') {
          setRecipientCheck({ status: 'missing', accountId: recipient });
        } else if (existence === 'exists') {
          setRecipientCheck({ status: 'exists', accountId: recipient });
        }
      }
      if (existence === 'missing') {
        fireMissingWarning();
        requestAnimationFrame(() => {
          recipientRef.current?.focus();
        });
        return;
      }
    }

    onCreate({
      jobId: values.jobId,
      recipient,
      amount: result.amountYocto,
    });
    onClose();
  }

  const hasErrors = Object.keys(errors).length > 0;

  const footer = (
    <div className="dialog__footer">
      <button type="button" className="button button--secondary" onClick={onClose}>
        Cancel
      </button>
      <button type="submit" form="create-job-form" className="button button--primary">
        Create payment
      </button>
    </div>
  );

  return (
    <>
      <Dialog isOpen={isOpen} onClose={onClose} title="New payment" footer={footer}>
        <form ref={formRef} id="create-job-form" className="dialog__form" onSubmit={handleSubmit} noValidate>
          {hasErrors && (
            <p className="field-error" role="alert">
              <svg className="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              Please fix the highlighted fields.
            </p>
          )}

          <div className="field">
            <label htmlFor="job-id">Payment ID</label>
            <input
              ref={jobIdRef}
              id="job-id"
              name="jobId"
              type="text"
              value={values.jobId}
              onChange={(event) => updateField('jobId', event.target.value)}
              onBlur={() => handleBlur('jobId')}
              placeholder="website-redesign-01"
              aria-invalid={Boolean(errors.jobId)}
              aria-describedby={
                errors.jobId ? 'job-id-hint job-id-error' : 'job-id-hint'
              }
              autoComplete="off"
              spellCheck={false}
            />
            <p id="job-id-hint" className="field-hint">
              Non-blank, unique, and at most 64 UTF-8 bytes.
            </p>
            {errors.jobId && (
              <p id="job-id-error" className="field-error">
                <svg className="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {errors.jobId}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="recipient">Recipient account</label>
            <div
              className={`recipient-field${recipientInvalid ? ' is-invalid' : ''}`}
            >
              <input
                ref={recipientRef}
                id="recipient"
                name="recipient"
                type="text"
                className="recipient-field__input"
                style={
                  recipientWidth !== undefined
                    ? { width: `${recipientWidth + 2}px` }
                    : undefined
                }
                value={values.recipient}
                onChange={(event) => updateField('recipient', event.target.value)}
                onBlur={() => handleBlur('recipient')}
                aria-invalid={recipientInvalid}
                aria-describedby={
                  errors.recipient
                    ? 'recipient-hint recipient-error'
                    : 'recipient-hint'
                }
                placeholder={RECIPIENT_PLACEHOLDER}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
              />
              <span
                ref={recipientMeasureRef}
                className="recipient-field__measure"
                aria-hidden="true"
              >
                {values.recipient.length > 0
                  ? values.recipient
                  : RECIPIENT_PLACEHOLDER}
              </span>
              <span className="recipient-field__suffix" aria-hidden="true">
                {RECIPIENT_SUFFIX}
              </span>
            </div>
            <p id="recipient-hint" className="field-hint">
              Type the name. The ending is already there.
            </p>
            {errors.recipient && (
              <p id="recipient-error" className="field-error">
                <svg className="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {errors.recipient}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="amount">Amount (NEAR)</label>
            <input
              ref={amountRef}
              id="amount"
              name="amountNear"
              type="text"
              inputMode="decimal"
              value={values.amountNear}
              onChange={(event) => updateField('amountNear', event.target.value)}
              onBlur={() => handleBlur('amountNear')}
              aria-invalid={Boolean(errors.amountNear)}
              aria-describedby={
                errors.amountNear ? 'amount-hint amount-error' : 'amount-hint'
              }
              placeholder="12.5"
              autoComplete="off"
              spellCheck={false}
            />
            <p id="amount-hint" className="field-hint">
              Positive only, up to 24 decimal places. 1 NEAR = 10²⁴ yoctoNEAR.
            </p>
            {errors.amountNear && (
              <p id="amount-error" className="field-error">
                <svg className="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {errors.amountNear}
              </p>
            )}
          </div>

          <p className="field-hint" style={{ textAlign: 'center', marginTop: 'var(--spacing-3)' }}>
            {mode === 'live'
              ? 'This sends a real testnet transaction. Your wallet will ask you to approve it.'
              : 'This payment lives in your browser with pretend money. No transaction is sent.'}
          </p>
        </form>
      </Dialog>

      {dialogToast && (
        <Toast
          key={dialogToast.key}
          message={dialogToast.message}
          tone="warning"
          onDismiss={dismissDialogToast}
        />
      )}
    </>
  );
}
