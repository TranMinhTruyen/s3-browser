import { describe, expect, it } from 'vitest';
import StatusDot from '@/components/display/StatusDot';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

const overlay = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('.mantine-ColorSwatch-colorOverlay') as HTMLElement;

describe('StatusDot', () => {
  it.each([
    [true, 'var(--mantine-color-green-6)'],
    [false, 'var(--mantine-color-red-6)'],
  ])('connected=%s is drawn in %s', (connected, color) => {
    const { container } = renderWithProviders(<StatusDot connected={connected} />);
    expect(overlay(container).style.backgroundColor).toBe(color);
  });

  it('is a 10px dot that does not shrink in a flex row', () => {
    const { container } = renderWithProviders(<StatusDot connected />);
    const root = container.querySelector<HTMLElement>('.mantine-ColorSwatch-root') as HTMLElement;
    expect(root.style.getPropertyValue('--cs-size')).toContain('0.625rem');
    expect(root.style.flexShrink).toBe('0');
  });
});
