import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import TransferSizes from '@/components/layouts/transfer/TransferSizes';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

describe('TransferSizes', () => {
  it('shows both labels with their sizes', () => {
    renderWithProviders(
      <TransferSizes doneLabel="Done" doneSize="1 KiB" remainingLabel="Left" remainingSize="2 MiB" />
    );

    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('1 KiB')).toBeInTheDocument();
    expect(screen.getByText('Left')).toBeInTheDocument();
    expect(screen.getByText('2 MiB')).toBeInTheDocument();
  });

  it('keeps each size next to its own label', () => {
    renderWithProviders(
      <TransferSizes doneLabel="Done" doneSize="1 KiB" remainingLabel="Left" remainingSize="2 MiB" />
    );

    expect(screen.getByText('Done').parentElement).toContainElement(screen.getByText('1 KiB'));
    expect(screen.getByText('Left').parentElement).toContainElement(screen.getByText('2 MiB'));
  });
});
