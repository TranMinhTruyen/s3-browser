import { MantineProvider } from '@mantine/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

import './style.css';
import '@mantine/core/styles.css';
import NiceModal from '@ebay/nice-modal-react';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider>
      <NiceModal.Provider>
        <App />
      </NiceModal.Provider>
    </MantineProvider>
  </StrictMode>
);
