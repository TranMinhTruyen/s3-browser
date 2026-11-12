import { MantineProvider } from '@mantine/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

import './style.css';
import '@mantine/core/styles.css';
import NiceModal from '@ebay/nice-modal-react';
import { LucideProvider } from 'lucide-react';
import { appTheme } from '@/common/theme/appTheme';
import { settingColorSchemeManager } from '@/common/utils/settingUtils';
import MotionProvider from '@/components/providers/MotionProvider';
import { loadStartupData } from '@/pages/s3/utils/startup';

// Settings and tabs are ready before the first render; App loads the profiles afterwards and clears deleted ones.
await loadStartupData();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={appTheme} colorSchemeManager={settingColorSchemeManager}>
      {/* Icons without their own size follow the root font-size; NiceModal renders outside <App>, so it wraps both. */}
      {/* lucide types `size` as number but passes it straight to the SVG width/height, so a rem string works. */}
      <LucideProvider size={'1.5rem' as unknown as number}>
        <NiceModal.Provider>
          <MotionProvider>
            <App />
          </MotionProvider>
        </NiceModal.Provider>
      </LucideProvider>
    </MantineProvider>
  </StrictMode>
);
