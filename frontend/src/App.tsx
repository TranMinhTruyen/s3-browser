import { useEffect, useLayoutEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useCredentialExpiring } from '@/common/hooks/useCredentialExpiring';
import { useTabPersistence } from '@/common/hooks/useTabPersistence';
import { useMasterDataStore } from '@/common/stores/masterDataStore';
import { useProfileStore } from '@/common/stores/profileStore';
import { normalizeTabProfilesFromDisk } from '@/common/utils/tabPersistence';
import AppUpdateToast from '@/components/layouts/AppUpdateToast';
import MainLayout from '@/components/layouts/MainLayout';
import RouterItems from '@/components/router/RouterItem';
import i18n from '@/locales/i18n';

function App() {
  const loadAll = useMasterDataStore(m => m.loadAll);
  const reset = useMasterDataStore(m => m.reset);
  const resetProfiles = useProfileStore(s => s.reset);

  useTabPersistence();
  useCredentialExpiring();

  useLayoutEffect(() => {
    loadAll();
    return () => {
      reset();
    };
  }, [loadAll, reset]);

  // Profiles are loaded once, here. The IPC is async, so a load error toast always fires after every effect
  // (including the Toaster's) has mounted. Under StrictMode the first load is dropped by the cleanup reset.
  useEffect(() => {
    void normalizeTabProfilesFromDisk();
    return () => {
      resetProfiles();
    };
  }, [resetProfiles]);

  return (
    <BrowserRouter>
      <I18nextProvider i18n={i18n}>
        <Routes>
          <Route element={<MainLayout />}>
            {RouterItems.map(item => (
              <Route key={item.path} path={item.path} element={item.page} />
            ))}
          </Route>
        </Routes>
        <Toaster position={'top-center'} richColors={true} closeButton={true} duration={10000} />
        <AppUpdateToast />
      </I18nextProvider>
    </BrowserRouter>
  );
}
export default App;
