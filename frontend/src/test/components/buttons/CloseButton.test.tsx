import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import actionIconClasses from '@/components/buttons/ActionIcon.module.css';
import CloseButton from '@/components/buttons/CloseButton';
import classes from '@/components/buttons/CloseButton.module.css';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

describe('CloseButton', () => {
  it('is named by its tooltip, shows the X icon and the tooltip on hover', async () => {
    renderWithProviders(<CloseButton tooltip="Close it" />);
    const button = screen.getByRole('button', { name: 'Close it' });

    expect(button.querySelector('svg.lucide-x')).toBeInTheDocument();
    await userEvent.hover(button);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Close it');
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    renderWithProviders(<CloseButton tooltip="Close it" onClick={onClick} />);

    await userEvent.click(screen.getByRole('button', { name: 'Close it' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is a plain button, so clicking it inside a form does not submit the form', async () => {
    const onSubmit = vi.fn((e: React.SyntheticEvent) => e.preventDefault());
    renderWithProviders(
      <form onSubmit={onSubmit}>
        <CloseButton tooltip="Close it" />
      </form>
    );
    const button = screen.getByRole('button', { name: 'Close it' });

    await userEvent.click(button);

    expect(button).toHaveAttribute('type', 'button');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('is disabled and ignores clicks when disabled', async () => {
    const onClick = vi.fn();
    renderWithProviders(<CloseButton tooltip="Close it" disabled onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Close it' });

    await userEvent.click(button);

    expect(button).toBeDisabled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it.each([
    ['md by default', undefined, 'md'],
    ['the given size', 'lg', 'lg'],
  ] as const)('uses %s', (_name, size, expected) => {
    renderWithProviders(<CloseButton tooltip="Close it" size={size} />);
    expect(screen.getByRole('button', { name: 'Close it' })).toHaveAttribute('data-size', expected);
  });

  it('keeps the hover class and adds the caller class', () => {
    renderWithProviders(<CloseButton tooltip="Close it" className="extra" />);
    const button = screen.getByRole('button', { name: 'Close it' });

    expect(button).toHaveClass(classes.closeButton, actionIconClasses.root, 'extra');
  });

  it('has only the hover class without a caller class', () => {
    renderWithProviders(<CloseButton tooltip="Close it" />);

    expect(screen.getByRole('button', { name: 'Close it' })).toHaveClass(classes.closeButton, actionIconClasses.root);
  });
});
