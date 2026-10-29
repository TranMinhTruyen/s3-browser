import { MantineProvider } from '@mantine/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

import './style.css';
import '@mantine/core/styles.css';
import NiceModal from '@ebay/nice-modal-react';
import { useSettingStore } from '@/common/stores/settingStore';
import { installDropTargetCleanup } from '@/common/utils/dropTargetUtils';
import { settingColorSchemeManager } from '@/common/utils/settingUtils';
import { normalizeTabProfilesFromDisk, restoreTabsFromDisk } from '@/common/utils/tabPersistence';

installDropTargetCleanup();

// Settings must be applied before the first paint, so the UI never flashes the wrong theme, font or language.
await useSettingStore.getState().load();

// Tabs are restored before the first render; tabs of deleted profiles lose their profile once profiles are loaded.
await restoreTabsFromDisk();
await normalizeTabProfilesFromDisk();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider colorSchemeManager={settingColorSchemeManager}>
      <NiceModal.Provider>
        <App />
      </NiceModal.Provider>
    </MantineProvider>
  </StrictMode>
);
