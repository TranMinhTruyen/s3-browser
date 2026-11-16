import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import S3Workspace from '@/pages/s3/S3Workspace';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

vi.mock('@/pages/s3/navbar/S3Navbar', () => ({ default: () => <div>left navbar</div> }));
vi.mock('@/pages/s3/S3TabPage', () => ({ default: () => <div>tab page</div> }));

describe('S3Workspace', () => {
  it('renders the navbar and the tab page in two panes', () => {
    renderWithProviders(<S3Workspace />);

    expect(screen.getByText('left navbar')).toBeInTheDocument();
    expect(screen.getByText('tab page')).toBeInTheDocument();
    expect(screen.getByText('left navbar').closest('.mantine-Splitter-pane')).not.toBe(
      screen.getByText('tab page').closest('.mantine-Splitter-pane')
    );
    expect(document.querySelectorAll('.mantine-Splitter-pane')).toHaveLength(2);
  });
});
