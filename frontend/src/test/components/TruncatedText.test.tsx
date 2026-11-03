import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import TruncatedText from '@/components/TruncatedText';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

/** jsdom has no layout: fake the measured widths of the text element. */
const setWidths = (el: HTMLElement, scrollWidth: number, clientWidth: number) => {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
};

describe('TruncatedText', () => {
  it('renders its text and no tooltip before any hover', () => {
    renderWithProviders(<TruncatedText>some name</TruncatedText>);

    expect(screen.getAllByText('some name')).toHaveLength(1);
  });

  it('shows the text itself as the tooltip when it is cut and no label is given', async () => {
    renderWithProviders(<TruncatedText>some long name</TruncatedText>);
    const text = screen.getByText('some long name');
    setWidths(text, 200, 100);

    await userEvent.hover(text);

    await waitFor(() => expect(screen.getAllByText('some long name')).toHaveLength(2));
  });

  it('shows the custom label when the text is cut', async () => {
    renderWithProviders(<TruncatedText label="full/path/name">name</TruncatedText>);
    const text = screen.getByText('name');
    setWidths(text, 200, 100);

    await userEvent.hover(text);

    expect(await screen.findByText('full/path/name')).toBeInTheDocument();
  });

  it.each([
    ['equal widths', 100, 100],
    ['scrollWidth smaller', 50, 100],
  ])('shows no tooltip when the text is not cut (%s)', async (_name, scrollWidth, clientWidth) => {
    renderWithProviders(<TruncatedText>short</TruncatedText>);
    const text = screen.getByText('short');
    setWidths(text, scrollWidth, clientWidth);

    await userEvent.hover(text);

    expect(screen.getAllByText('short')).toHaveLength(1);
  });

  it('shows the tooltip of an uncut text when alwaysTip is set', async () => {
    renderWithProviders(
      <TruncatedText alwaysTip label="the label">
        short
      </TruncatedText>
    );
    const text = screen.getByText('short');
    setWidths(text, 10, 100);

    await userEvent.hover(text);

    expect(await screen.findByText('the label')).toBeInTheDocument();
  });

  it('does not show the tooltip of an uncut text when alwaysTip is false', async () => {
    renderWithProviders(
      <TruncatedText alwaysTip={false} label="the label">
        short
      </TruncatedText>
    );
    const text = screen.getByText('short');
    setWidths(text, 10, 100);

    await userEvent.hover(text);

    expect(screen.queryByText('the label')).not.toBeInTheDocument();
  });

  it('closes the tooltip when the mouse leaves', async () => {
    renderWithProviders(<TruncatedText>some long name</TruncatedText>);
    const text = screen.getByText('some long name');
    setWidths(text, 200, 100);
    await userEvent.hover(text);
    await waitFor(() => expect(screen.getAllByText('some long name')).toHaveLength(2));

    await userEvent.unhover(text);

    await waitFor(() => expect(screen.getAllByText('some long name')).toHaveLength(1));
  });

  it('renders without children', () => {
    renderWithProviders(<TruncatedText data-testid="t" />);

    expect(screen.getByTestId('t')).toBeEmptyDOMElement();
  });

  it('passes text props through and truncates with an ellipsis', () => {
    renderWithProviders(
      <TruncatedText fw={700} data-testid="t">
        bold
      </TruncatedText>
    );

    const text = screen.getByTestId('t');
    expect(text).toHaveAttribute('data-truncate', 'end');
    expect(text).toHaveStyle({ fontWeight: '700' });
  });
});
