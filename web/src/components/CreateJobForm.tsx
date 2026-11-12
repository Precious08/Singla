import { useRef, useState, type FormEvent } from 'react';
import {
  DEMO_CONTRACT_ACCOUNT,
  validateCreateJob,
  type CreateJobErrors,
  type CreateJobValues,
} from '../lib/validation';

interface CreateJobFormProps {
  existingIds: ReadonlySet<string>;
  onCreate: (job: {
    jobId: string;
    recipient: string;
    amount: string;
  }) => void;
}

const EMPTY_VALUES: CreateJobValues = {
  jobId: '',
  recipient: '',
  amountNear: '',
};

type FieldName = keyof CreateJobValues;

export function CreateJobForm({ existingIds, onCreate }: CreateJobFormProps) {
  const [values, setValues] = useState<CreateJobValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<CreateJobErrors>({});
  const [success, setSuccess] = useState('');
  const jobIdRef = useRef<HTMLInputElement>(null);
  const recipientRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  function updateField(field: FieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (success) {
      setSuccess('');
    }
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
    setSuccess('');
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
    setSuccess(
      `Created "${values.jobId}" locally. No transaction was sent.`,
    );
    setValues(EMPTY_VALUES);
    setErrors({});
  }

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <section className="panel create-panel" aria-labelledby="create-heading">
      <div className="panel__heading">
        <div>
          <p className="eyebrow">Local action</p>
          <h2 id="create-heading">Create a demo job</h2>
        </div>
      </div>

      <form className="form" onSubmit={handleSubmit} noValidate>
        {hasErrors && (
          <p className="form-alert" role="alert">
            Please fix the highlighted fields.
          </p>
        )}

        {success && (
          <p className="form-success" role="status">
            {success}
          </p>
        )}

        <div className="field">
          <label htmlFor="job-id">Job ID</label>
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
          <p id="job-id-hint" className="hint">
            Non-blank, unique, and at most 64 UTF-8 bytes.
          </p>
          {errors.jobId && (
            <p id="job-id-error" className="field-error">
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
            placeholder="demo-designer.testnet"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          <p id="recipient-hint" className="hint">
            A valid NEAR account ID. Cannot be the demo contract account (
            <span className="mono">{DEMO_CONTRACT_ACCOUNT}</span>).
          </p>
          {errors.recipient && (
            <p id="recipient-error" className="field-error">
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
          <p id="amount-hint" className="hint">
            Positive only, up to 24 decimal places. 1 NEAR = 10²⁴ yoctoNEAR.
          </p>
          {errors.amountNear && (
            <p id="amount-error" className="field-error">
              {errors.amountNear}
            </p>
          )}
        </div>

        <button type="submit" className="button button--primary button--block">
          Create demo job
        </button>
        <p className="form-note">
          This only updates local page state. No transaction is sent and no
          wallet is connected.
        </p>
      </form>
    </section>
  );
}
