import NiceModal from '@ebay/nice-modal-react';
import { MantineProvider } from '@mantine/core';
import { type RenderOptions, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/locales/i18n';

export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, {
    wrapper: ({ children }) => (
      <MantineProvider>
        <I18nextProvider i18n={i18n}>
          <NiceModal.Provider>{children}</NiceModal.Provider>
        </I18nextProvider>
      </MantineProvider>
    ),
    ...options,
  });
}
