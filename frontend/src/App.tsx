import { useEffect, useLayoutEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import { Toaster } from 'sonner';
import AppUpdateToast from '@/components/layouts/AppUpdateToast';
import MainLayout from '@/components/layouts/MainLayout';
import i18n from '@/locales/i18n';
import { useCredentialExpiring } from '@/pages/s3/hooks/useCredentialExpiring';
import { useTabPersistence } from '@/pages/s3/hooks/useTabPersistence';
import { useMasterDataStore } from '@/pages/s3/stores/masterDataStore';
import { useProfileStore } from '@/pages/s3/stores/profileStore';
import { normalizeTabProfilesFromDisk } from '@/pages/s3/utils/tabPersistence';

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
    <I18nextProvider i18n={i18n}>
      <MainLayout />
      <Toaster position={'top-center'} richColors={true} closeButton={true} duration={10000} />
      <AppUpdateToast />
    </I18nextProvider>
  );
}
export default App;
