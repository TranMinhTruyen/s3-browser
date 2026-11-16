import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SliderInput from '@/components/inputs/SliderInput';
import classes from '@/components/inputs/SliderInput.module.css';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const marks = [
  { value: 0, label: 'Small' },
  { value: 1, label: 'Medium' },
  { value: 2, label: 'Large' },
];
const base = { min: 0, max: 2, step: 1, marks, thumbLabel: 'Interface size' };

describe('SliderInput', () => {
  it('names the thumb after a string label when no thumbLabel is given', () => {
    renderWithProviders(
      <SliderInput min={0} max={2} step={1} label="Interface size field" value={1} onChange={vi.fn()} />
    );
    expect(screen.getByRole('slider', { name: 'Interface size field' })).toBeInTheDocument();
  });

  it('prefers an explicit thumbLabel over the field label', () => {
    renderWithProviders(<SliderInput {...base} label="Interface size field" value={1} onChange={vi.fn()} />);
    expect(screen.getByRole('slider', { name: 'Interface size' })).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Interface size field' })).not.toBeInTheDocument();
  });

  it('leaves the thumb unnamed for a non-string label without thumbLabel', () => {
    renderWithProviders(<SliderInput min={0} max={2} step={1} label={<b>Rich</b>} value={1} onChange={vi.fn()} />);
    expect(screen.getByText('Rich')).toBeInTheDocument();
    expect(screen.getByRole('slider')).not.toHaveAccessibleName('Rich');
  });

  it('ignores a function-form classNames and keeps the module classes', () => {
    renderWithProviders(
      <SliderInput {...base} value={1} onChange={vi.fn()} classNames={() => ({ root: 'fn-root' })} />
    );
    expect(screen.getByText('Medium')).toHaveClass(classes.markLabel);
  });

  it('shows the field label above the slider', () => {
    renderWithProviders(<SliderInput {...base} label="Interface size field" value={1} onChange={vi.fn()} />);
    expect(screen.getByText('Interface size field')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Interface size' })).toHaveAttribute('aria-valuenow', '1');
  });

  it('renders no field label without the label prop', () => {
    renderWithProviders(<SliderInput {...base} value={0} onChange={vi.fn()} />);
    expect(screen.queryByText('Interface size field')).not.toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Interface size' })).toHaveAttribute('aria-valuenow', '0');
  });

  it('passes the marks down and shows no floating label on the thumb', () => {
    renderWithProviders(<SliderInput {...base} value={2} onChange={vi.fn()} />);
    for (const name of ['Small', 'Medium', 'Large']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    screen.getByRole('slider', { name: 'Interface size' }).focus();
    expect(screen.queryByText('2')).not.toBeInTheDocument();
  });

  it('calls onChange and onChangeEnd when an arrow key moves the thumb', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    renderWithProviders(<SliderInput {...base} value={1} onChange={onChange} onChangeEnd={onChangeEnd} />);

    screen.getByRole('slider', { name: 'Interface size' }).focus();
    await user.keyboard('{ArrowRight}');

    expect(onChange).toHaveBeenCalledWith(2);
    expect(onChangeEnd).toHaveBeenCalledWith(2);
  });

  it('applies the module classes to the mark wrappers and labels', () => {
    const { container } = renderWithProviders(<SliderInput {...base} value={1} onChange={vi.fn()} />);
    expect(container.querySelectorAll(`.${classes.markWrapper}`)).toHaveLength(3);
    expect(container.querySelectorAll(`.${classes.markLabel}`)).toHaveLength(3);
    expect(screen.getByText('Small')).toHaveClass(classes.markLabel);
  });

  it('lets the caller classNames add to the module classes', () => {
    renderWithProviders(
      <SliderInput
        {...base}
        value={1}
        onChange={vi.fn()}
        classNames={{ markLabel: 'caller-label', markWrapper: 'caller-wrapper', thumb: 'caller-thumb' }}
      />
    );
    const label = screen.getByText('Medium');
    expect(label).toHaveClass(classes.markLabel, 'caller-label');
    const wrapper = label.parentElement as HTMLElement;
    expect(wrapper).toHaveClass(classes.markWrapper, 'caller-wrapper');
    expect(screen.getByRole('slider', { name: 'Interface size' })).toHaveClass('caller-thumb');
  });

  it('keeps only the module class when the caller sets no mark classes', () => {
    renderWithProviders(<SliderInput {...base} value={1} onChange={vi.fn()} classNames={{ root: 'caller-root' }} />);
    const label = screen.getByText('Medium');
    expect(label).toHaveClass(classes.markLabel);
    expect(label.className).not.toContain('undefined');
    expect((label.parentElement as HTMLElement).className).not.toContain('undefined');
  });
});
