import { type CSSProperties, useEffect, useLayoutEffect } from 'react';
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

// Sonner đặt kích thước toast theo px: chiều rộng, padding và chữ co giãn theo cỡ giao diện (mặc định 356px / 16px / 13px).
const TOASTER_STYLE = { '--width': '22.25rem' } as CSSProperties;
const TOAST_OPTIONS = { style: { fontSize: 'var(--mantine-font-size-sm)', padding: '1rem' } };

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

  // Profile chỉ tải một lần tại đây. IPC chạy bất đồng bộ nên toast lỗi tải luôn xuất hiện sau khi mọi effect
  // (kể cả effect của Toaster) đã mount. Trong StrictMode, cleanup reset sẽ loại bỏ lượt tải đầu tiên.
  useEffect(() => {
    void normalizeTabProfilesFromDisk();
    return () => {
      resetProfiles();
    };
  }, [resetProfiles]);

  return (
    <I18nextProvider i18n={i18n}>
      <MainLayout />
      <Toaster
        position={'top-center'}
        richColors={true}
        closeButton={true}
        duration={5000}
        style={TOASTER_STYLE}
        toastOptions={TOAST_OPTIONS}
      />
      <AppUpdateToast />
    </I18nextProvider>
  );
}
export default App;
