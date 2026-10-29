import { useLayoutEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useMasterDataStore } from '@/common/stores/masterDataStore';
import MainLayout from '@/components/layouts/MainLayout';
import { useTabPersistence } from '@/components/layouts/tab/useTabPersistence';
import RouterItems from '@/components/router/RouterItem';
import i18n from '@/locales/i18n';

function App() {
  const loadAll = useMasterDataStore(m => m.loadAll);
  const reset = useMasterDataStore(m => m.reset);

  useTabPersistence();

  useLayoutEffect(() => {
    loadAll();
    return () => {
      reset();
    };
  }, [loadAll, reset]);

  return (
    <BrowserRouter>
      <I18nextProvider i18n={i18n}>
        <Routes>
          <Route element={<MainLayout />}>
            {RouterItems.map((item, index) => (
              <Route key={`${index}-${item.path}`} path={item.path} element={item.page} />
            ))}
          </Route>
        </Routes>
        <Toaster position={'top-center'} richColors={true} closeButton={true} />
      </I18nextProvider>
    </BrowserRouter>
  );
}
export default App;
