import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SegmentedControl from '@/components/inputs/SegmentedControl';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const labelOf = (text: string) => screen.getByText(text).closest('label') as HTMLElement;

describe('SegmentedControl', () => {
  it('adds the centering classes to the label and the inner label', () => {
    renderWithProviders(<SegmentedControl data={['A', 'B']} />);
    expect(labelOf('A').className).toContain('label');
    expect(screen.getByText('A').className).toContain('innerLabel');
  });

  it('keeps the other props: value, disabled item and onChange', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <SegmentedControl data={['A', 'B', { value: 'C', label: 'C', disabled: true }]} value="A" onChange={onChange} />
    );
    expect(screen.getByLabelText('A')).toBeChecked();
    await userEvent.click(screen.getByLabelText('B'));
    expect(onChange).toHaveBeenCalledWith('B');
    expect(screen.getByLabelText('C')).toBeDisabled();
  });

  it('keeps the classNames of the caller (object) for the other parts', () => {
    const { container } = renderWithProviders(
      <SegmentedControl data={['A', 'B']} classNames={{ root: 'caller-root', indicator: 'caller-indicator' }} />
    );
    expect(container.querySelector('.caller-root')).not.toBeNull();
    expect(container.querySelector('.caller-indicator')).not.toBeNull();
    expect(labelOf('A').className).toContain('label');
  });

  it('keeps the label classes of the caller next to the own ones', () => {
    renderWithProviders(
      <SegmentedControl data={['A', 'B']} classNames={{ label: 'caller-label', innerLabel: 'caller-inner' }} />
    );
    expect(labelOf('A').className).toContain('caller-label');
    expect(labelOf('A').className).toContain('label');
    expect(screen.getByText('A').className).toContain('caller-inner');
    expect(screen.getByText('A').className).toContain('innerLabel');
  });

  it('keeps the classNames of the caller given as a function', () => {
    const { container } = renderWithProviders(
      <SegmentedControl data={['A', 'B']} classNames={() => ({ root: 'fn-root' })} />
    );
    expect(container.querySelector('.fn-root')).not.toBeNull();
    expect(labelOf('A').className).toContain('label');
  });
});
