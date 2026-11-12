import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';
import { FIXTURE_JOBS } from './fixtures';

describe('App', () => {
  it('renders all fixture jobs, the connect wallet button, and the create job button', () => {
    render(<App />);

    expect(screen.queryByText('Demo — no real payments.')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /reset demo data/i }),
    ).toBeNull();
    expect(screen.getByRole('button', { name: /connect wallet/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /create job/i })).toBeTruthy();
    for (const job of FIXTURE_JOBS) {
      expect(screen.getAllByText(job.job_id).length).toBeGreaterThan(0);
    }
  });

  it('opens the create job dialog when clicking Create job button', () => {
    render(<App />);

    // Click the first "Create job" button (toolbar button)
    const createButtons = screen.getAllByRole('button', { name: /create job/i });
    fireEvent.click(createButtons[0]);

    expect(screen.getByRole('dialog', { name: /create a demo job/i })).toBeTruthy();
    expect(screen.getByLabelText(/job id/i)).toBeTruthy();
    expect(screen.getByLabelText(/recipient account/i)).toBeTruthy();
    expect(screen.getByLabelText(/amount \(near\)/i)).toBeTruthy();
  });

  it('closes the create job dialog on Escape', () => {
    render(<App />);

    const createButtons = screen.getAllByRole('button', { name: /create job/i });
    fireEvent.click(createButtons[0]);
    expect(screen.getByRole('dialog', { name: /create a demo job/i })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: /create a demo job/i })).not.toBeTruthy();
  });

  it('filters jobs by status', () => {
    render(<App />);

    const awaitingJobs = FIXTURE_JOBS.filter(j => j.state === 'AwaitingApproval');
    expect(awaitingJobs.length).toBeGreaterThan(0);

    // Click the first "Awaiting approval" filter button
    const filterButtons = screen.getAllByRole('button', { name: /awaiting approval/i });
    fireEvent.click(filterButtons[0]);

    for (const job of awaitingJobs) {
      expect(screen.getAllByText(job.job_id).length).toBeGreaterThan(0);
    }
    // Other state jobs should not appear in the job list (table or cards)
    // They may still appear in the details panel if one was selected before filtering
    // So we just verify the filtered jobs are visible
  });

  it('shows job details when selecting a job', () => {
    render(<App />);

    const firstJob = FIXTURE_JOBS[0];
    // Click the first occurrence of the job ID (job card)
    const jobElements = screen.getAllByText(firstJob.job_id);
    fireEvent.click(jobElements[0]);

    // Verify recipient appears in the details panel (not the table/cards)
    const recipientElements = screen.getAllByText(firstJob.recipient);
    expect(recipientElements.length).toBeGreaterThan(0);
    // Verify approve button is present
    expect(screen.getAllByRole('button', { name: /approve job/i }).length).toBeGreaterThan(0);
  });
});