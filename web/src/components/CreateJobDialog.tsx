import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Dialog } from './Dialog';
import {
  validateCreateJob,
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

export function CreateJobDialog({
  isOpen,
  onClose,
  existingIds,
  onCreate,
  mode = 'try',
}: CreateJobDialogProps) {
  const [values, setValues] = useState<CreateJobValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<CreateJobErrors>({});
  const jobIdRef = useRef<HTMLInputElement>(null);
  const recipientRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValues(EMPTY_VALUES);
      setErrors({});
      requestAnimationFrame(() => {
        jobIdRef.current?.focus();
      });
    }
  }, [isOpen]);

  function updateField(field: FieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateCreateJob(values, existingIds);

    if (!result.amountYocto || Object.keys(result.errors).length > 0) {
      setErrors(result.errors);
      focusFirstError(result.errors);
      return;
    }

    onCreate({
      jobId: values.jobId,
      recipient: values.recipient,
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
          <input
            ref={recipientRef}
            id="recipient"
            name="recipient"
            type="text"
            value={values.recipient}
            onChange={(event) => updateField('recipient', event.target.value)}
            onBlur={() => handleBlur('recipient')}
            aria-invalid={Boolean(errors.recipient)}
            aria-describedby={
              errors.recipient
                ? 'recipient-hint recipient-error'
                : 'recipient-hint'
            }
            placeholder="sofia.kitchen.testnet"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          <p id="recipient-hint" className="field-hint">
            A valid NEAR account ID.
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
  );
}