import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import UpdateProgress from '@/components/display/UpdateProgress';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

describe('UpdateProgress', () => {
  it('shows the percent with written and total size', () => {
    renderWithProviders(<UpdateProgress written={1024} total={2048} />);

    expect(screen.getByText(/^50% · .+ \/ .+$/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('caps the percent at 100', () => {
    renderWithProviders(<UpdateProgress written={3000} total={2000} />);

    expect(screen.getByText(/^100% · /)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('shows only the written size, with a full animated bar, when the total is unknown', () => {
    renderWithProviders(<UpdateProgress written={1024} total={0} />);

    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-animated', 'true');
  });
});
