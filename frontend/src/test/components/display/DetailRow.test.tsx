import { DataList } from '@mantine/core';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import DetailRow, { EMPTY_VALUE } from '@/components/display/DetailRow';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const renderRow = (row: React.ReactElement) => renderWithProviders(<DataList>{row}</DataList>);

describe('DetailRow', () => {
  it('shows the label and the value', () => {
    renderRow(<DetailRow label="Region" value="eu-west-1" />);

    expect(screen.getByText('Region')).toBeInTheDocument();
    expect(screen.getByText('eu-west-1')).toBeInTheDocument();
  });

  it.each([[undefined], ['']])('shows a dash for the empty value %j', value => {
    renderRow(<DetailRow label="Region" value={value} />);

    expect(screen.getByText(EMPTY_VALUE)).toBeInTheDocument();
  });

  it('has no copy button unless copyable', () => {
    renderRow(<DetailRow label="ARN" value="arn:x" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('has no copy button for a copyable row without a value', () => {
    renderRow(<DetailRow label="ARN" copyable />);

    expect(screen.getByText(EMPTY_VALUE)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('copies the value and switches the tooltip to Copied', async () => {
    const user = userEvent.setup();
    renderRow(<DetailRow label="ARN" value="arn:x" copyable />);

    await user.click(screen.getByRole('button', { name: 'Copy' }));

    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe('arn:x');
  });
});
