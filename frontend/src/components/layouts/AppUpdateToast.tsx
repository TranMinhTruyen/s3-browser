import { useAppUpdate } from '@/common/hooks/useAppUpdate';

/** Renders nothing; isolates the update progress re-renders from `App`. */
function AppUpdateToast() {
  useAppUpdate();
  return null;
}
export default AppUpdateToast;
