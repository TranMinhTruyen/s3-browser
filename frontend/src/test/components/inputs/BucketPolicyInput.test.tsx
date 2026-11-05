import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import BucketPolicyInput from '@/components/inputs/BucketPolicyInput';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

type Props = Partial<Parameters<typeof BucketPolicyInput>[0]>;
function setup(props: Props = {}) {
  const onChangeMode = vi.fn();
  const onChangePolicy = vi.fn();
  renderWithProviders(
    <BucketPolicyInput
      mode="private"
      policy=""
      onChangeMode={onChangeMode}
      onChangePolicy={onChangePolicy}
      {...props}
    />
  );
  return { onChangeMode, onChangePolicy };
}

const segment = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement;
const policyField = () => screen.queryByLabelText(/Policy \(JSON\)/) as HTMLTextAreaElement | null;

describe('BucketPolicyInput', () => {
  it('shows the three modes with the hint of the current one and no JSON field', () => {
    setup();

    expect(segment('Private')).toBeChecked();
    expect(segment('Public (read-only)')).not.toBeChecked();
    expect(segment('Custom')).not.toBeChecked();
    expect(screen.getByText(/No bucket policy/)).toBeInTheDocument();
    expect(policyField()).not.toBeInTheDocument();
  });

  it.each([
    ['Public (read-only)', 'public'],
    ['Custom', 'custom'],
  ])('calls onChangeMode with %s', async (label, mode) => {
    const { onChangeMode } = setup();

    await userEvent.setup().click(segment(label));

    expect(onChangeMode).toHaveBeenCalledExactlyOnceWith(mode);
  });

  it('does not show the JSON field in public mode', () => {
    setup({ mode: 'public' });

    expect(screen.getByText(/Anyone can list and read/)).toBeInTheDocument();
    expect(policyField()).not.toBeInTheDocument();
  });

  it('shows the JSON field in custom mode and reports edits', () => {
    const { onChangePolicy } = setup({ mode: 'custom', policy: '{}' });

    expect(screen.getByText('Edit the bucket policy as JSON.')).toBeInTheDocument();
    expect(policyField()).toHaveValue('{}');
    fireEvent.change(policyField() as HTMLElement, { target: { value: '{"a":1}' } });
    expect(onChangePolicy).toHaveBeenCalledWith('{"a":1}');
  });

  it('flags invalid JSON', () => {
    setup({ mode: 'custom', policy: '{bad' });

    expect(policyField()).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not flag an empty custom policy', () => {
    setup({ mode: 'custom', policy: '' });

    expect(policyField()).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('disables the modes and makes the JSON field read-only when readOnly', () => {
    setup({ mode: 'custom', policy: '{}', readOnly: true });

    expect(segment('Private')).toBeDisabled();
    expect(segment('Custom')).toBeDisabled();
    expect(policyField()).toHaveAttribute('readonly');
  });
});
