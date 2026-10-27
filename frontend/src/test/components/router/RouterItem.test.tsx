import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';
import RouterItems from '@/components/router/RouterItem';

vi.mock('@/components/layouts/tab/TabLayout', () => ({ default: () => <div>tab layout</div> }));

describe('RouterItems', () => {
  it('declares a single root route with an empty prefix', () => {
    expect(RouterItems).toHaveLength(1);
    expect(RouterItems[0].path).toBe('/');
    expect(RouterItems[0].prefix).toBe('');
  });

  it('lazy-loads the tab layout as the root page', async () => {
    render(<Suspense fallback="loading">{RouterItems[0].page}</Suspense>);

    expect(await screen.findByText('tab layout')).toBeInTheDocument();
  });
});
