import { useAppUpdate } from '@/common/hooks/useAppUpdate';

/** Không hiển thị nội dung; tách các lần render lại tiến trình cập nhật khỏi `App`. */
function AppUpdateToast() {
  useAppUpdate();
  return null;
}
export default AppUpdateToast;
