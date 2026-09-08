import { isEmpty, isNil } from 'lodash';

/**
 * Check string is null or empty.
 * If string is null or empty return true.
 *
 * @param value
 * @returns
 */
export function isNullOrEmpty(value?: string | null) {
  return isNil(value) || isEmpty(value);
}

/**
 * Format string with params.
 *
 * @param template
 * @param params
 * @returns
 */
export function formatString(template: string, ...args: (string | number | bigint | null | undefined)[]): string {
  return template.replace(/{(\d+)}/g, (match, index) => {
    const paramIndex = parseInt(index, 10);
    return args[paramIndex] !== undefined && args[paramIndex] !== null ? args[paramIndex].toString() : match;
  });
}

/**
 * Format string with Json data.
 *
 * @param template
 * @param params
 * @returns
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
