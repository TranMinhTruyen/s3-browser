import { MantineProvider } from '@mantine/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

import './style.css';
import '@mantine/core/styles.css';
import NiceModal from '@ebay/nice-modal-react';
import { appTheme } from '@/common/theme/appTheme';
import { installDropTargetCleanup } from '@/common/utils/dropTargetUtils';
import { settingColorSchemeManager } from '@/common/utils/settingUtils';
import { loadStartupData } from '@/common/utils/startup';
import MotionProvider from '@/components/providers/MotionProvider';

installDropTargetCleanup();

// Settings and tabs are ready before the first render; App loads the profiles afterwards and clears deleted ones.
await loadStartupData();

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
