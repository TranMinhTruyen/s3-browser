import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { useFieldError } from '@/common/hooks/useFieldError';
import i18n from '@/locales/i18n';

const wrapper = ({ children }: { children: ReactNode }) => <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;

describe('useFieldError', () => {
  it('translates a string error with the label', () => {
    const { result } = renderHook(() => useFieldError(), { wrapper });
    expect(result.current('V000001', 'Name')).toBe('Name is required');
  });

  it('passes a non-string error through', () => {
    const { result } = renderHook(() => useFieldError(), { wrapper });
    const node = <span>custom</span>;
    expect(result.current(node, 'Name')).toBe(node);
  });
});
