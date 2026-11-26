// Màu header dùng chung cho các modal: kiểu thông tin (cũng là header mặc định) và kiểu cảnh báo.
// light-dark() theo scheme của Mantine; chỉ dùng biến theme, không ghi cứng mã hex.
export const INFO_BG_COLOR = 'light-dark(var(--mantine-color-blue-1), var(--mantine-color-blue-9))';
export const INFO_COLOR = 'light-dark(var(--mantine-color-indigo-8), var(--mantine-color-blue-3))';
export const WARNING_BG_COLOR = 'light-dark(var(--mantine-color-lime-1), var(--mantine-color-yellow-9))';
export const WARNING_COLOR = 'light-dark(var(--mantine-color-yellow-6), var(--mantine-color-yellow-4))';

/** Màu mặc định của profile kết nối mới. Được lưu cùng dữ liệu profile nên giữ ở dạng mã hex thuần. */
export const DEFAULT_PROFILE_COLOR = '#d0ebff';
