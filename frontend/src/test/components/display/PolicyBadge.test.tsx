import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import PolicyBadge from '@/components/display/PolicyBadge';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const skeleton = () => document.querySelector('.mantine-Skeleton-root');

describe('PolicyBadge', () => {
  it.each([[undefined], ['']])('shows a skeleton when the mode is not known yet (%s)', mode => {
    renderWithProviders(<PolicyBadge mode={mode} />);

    expect(skeleton()).toBeInTheDocument();
    expect(screen.queryByText(/^(Private|Public|Custom)$/)).not.toBeInTheDocument();
  });

  it.each([['unknown'], ['something-else']])('renders nothing for "%s"', mode => {
    const { container } = renderWithProviders(<PolicyBadge mode={mode} />);

    expect(skeleton()).not.toBeInTheDocument();
    expect(container.querySelector('.mantine-Badge-root')).not.toBeInTheDocument();
    expect(screen.queryByText(/^(Private|Public|Custom)$/)).not.toBeInTheDocument();
  });

  it.each([
    ['private', 'Private', 'Private: no bucket policy.'],
    ['public', 'Public', 'Public: anyone can read and list objects.'],
    ['custom', 'Custom', 'Custom: the bucket has a custom policy.'],
  ])('shows the %s badge with its tooltip', async (mode, label, tooltip) => {
    renderWithProviders(<PolicyBadge mode={mode} />);

    expect(skeleton()).not.toBeInTheDocument();
    await userEvent.hover(screen.getByText(label));
    expect(await screen.findByText(tooltip)).toBeInTheDocument();
  });
});
