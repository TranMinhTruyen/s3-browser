import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAppUpdate } from '@/common/hooks/useAppUpdate';
import AppUpdateToast from '@/components/layouts/AppUpdateToast';

vi.mock('@/common/hooks/useAppUpdate', () => ({ useAppUpdate: vi.fn() }));

describe('AppUpdateToast', () => {
  it('follows the update flow and renders nothing', () => {
    const { container } = render(<AppUpdateToast />);

    expect(useAppUpdate).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();
  });
});
