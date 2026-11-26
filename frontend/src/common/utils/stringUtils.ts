import { TFunction } from 'i18next';
import { v7 } from 'uuid';
import i18n from '@/locales/i18n';

/**
 * Kiểm tra chuỗi có phải null, undefined hoặc rỗng hay không (chuỗi chỉ có khoảng trắng vẫn được xem là không rỗng).
 *
 * @param value - chuỗi cần kiểm tra.
 * @returns true nếu không có nội dung.
 */
export function isNullOrEmpty(value?: string | null): value is null | undefined | '' {
  return value == null || value === '';
}

/**
 * Thay các chỗ giữ chỗ theo vị trí `{0}`, `{1}`, ... bằng các đối số.
 * Chỗ giữ chỗ không có đối số tương ứng (khác null) sẽ được giữ nguyên.
 *
 * @param template - văn bản chứa các chỗ giữ chỗ `{n}`.
 * @param args - giá trị cho `{0}`, `{1}`, ...
 * @returns văn bản đã định dạng.
 */
export function formatString(template: string, ...args: (string | number | bigint | null | undefined)[]): string {
  return template.replace(/{(\d+)}/g, (match, index) => {
    const paramIndex = parseInt(index, 10);
    return args[paramIndex] !== undefined && args[paramIndex] !== null ? args[paramIndex].toString() : match;
  });
}

/**
 * Thay các chỗ giữ chỗ có tên `{key}` / `{a.b}` bằng giá trị trong `params`.
 * Chỗ giữ chỗ không có giá trị tương ứng sẽ được giữ nguyên.
 *
 * @param template - văn bản chứa các chỗ giữ chỗ `{key}`.
 * @param params - các giá trị theo key; giá trị lồng nhau được đọc bằng đường dẫn dấu chấm.
 * @returns văn bản đã định dạng, hoặc '' nếu template rỗng.
 */
export function formatStringJson(
  template?: string,
  params?: Record<string, any> | { [x: string]: any } | null
): string {
  if (isNullOrEmpty(template)) {
    return '';
  }
  if (params == null) {
    return template;
  }
  return template.replace(/\{([^}]+)\}/g, (match: string, key: string): string => {
    const keys = key.trim().split('.');
    let value: any = params;
    for (const k of keys) {
      if (value == null) return match;
      value = value[k];
    }
    return value ?? match;
  });
}

/**
 * Chuyển mã kiểm tra dữ liệu (`V000002:255`) thành thông báo đã dịch.
 * Nhãn là `{0}`; các giá trị phân tách bằng dấu phẩy sau `:` lần lượt là `{1}`, `{2}`, ...
 *
 * @param rawError - mã kiểm tra dữ liệu, có thể kèm tham số.
 * @param label - nhãn trường được dùng làm `{0}`.
 * @param t - hàm dịch (mặc định dùng i18n toàn cục).
 * @returns thông báo đã dịch, hoặc lỗi gốc nếu kết quả dịch không phải chuỗi.
 */
export function formatFieldError(rawError: string, label: React.ReactNode, t: TFunction = i18n.t): string {
  const [code, paramsStr] = rawError.split(':');
  const template = t(code, { defaultValue: code });
  if (typeof template !== 'string') return rawError;

  const params = [String(label), ...(paramsStr ? paramsStr.split(',') : [])];
  return formatString(template, ...params);
}

/**
 * Tạo UUID (v7) có thứ tự theo thời gian, có thể thêm tiền tố.
 *
 * @param prefix - văn bản tùy chọn đặt trước UUID.
 * @returns "prefix-UUID" hoặc chỉ "UUID".
 */
export const createUUID = (prefix?: string) => [prefix, v7()].filter(Boolean).join('-');

/**
 * Định dạng số byte thành bytes / KiB / MiB / GiB (cơ số 1024, hai chữ số thập phân nếu lớn hơn bytes).
 *
 * @param sizeInBytes - kích thước tính bằng byte.
 * @returns kích thước ở dạng dễ đọc.
 */
export const formatFileSize = (sizeInBytes: number): string => {
  if (sizeInBytes < 1024) return `${sizeInBytes} bytes`;
  else if (sizeInBytes < 1024 * 1024) return `${(sizeInBytes / 1024).toFixed(2)} KiB`;
  else if (sizeInBytes < 1024 * 1024 * 1024) return `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MiB`;
  else return `${(sizeInBytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
};
