import { MantineProvider } from '@mantine/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

import './style.css';
import '@mantine/core/styles.css';
import NiceModal from '@ebay/nice-modal-react';
import { useSettingStore } from '@/common/stores/settingStore';
import { appTheme } from '@/common/theme/appTheme';
import { installDropTargetCleanup } from '@/common/utils/dropTargetUtils';
import { settingColorSchemeManager } from '@/common/utils/settingUtils';
import MotionProvider from '@/components/providers/MotionProvider';

installDropTargetCleanup();

// Settings must be applied before the first paint, so the UI never flashes the wrong theme, font or language.
await useSettingStore.getState().load();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={appTheme} colorSchemeManager={settingColorSchemeManager}>
      <NiceModal.Provider>
        <MotionProvider>
          <App />
        </MotionProvider>
      </NiceModal.Provider>
    </MantineProvider>
  </StrictMode>
);
