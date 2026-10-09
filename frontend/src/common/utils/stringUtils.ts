import { TFunction } from 'i18next';
import { isEmpty, isNil } from 'lodash';
import { v7 } from 'uuid';
import i18n from '@/locales/i18n';

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

export function formatFieldError(rawError: string, label: React.ReactNode, t: TFunction = i18n.t): string {
  const [code, paramsStr] = rawError.split(':');
  const template = t(`${code}`, { defaultValue: code });
  if (typeof template !== 'string') return rawError;

  const params = [String(label), ...(paramsStr ? paramsStr.split(',') : [])];
  return formatString(template, ...params);
}

/**
 * Generates a UUID string (version 7), optionally prefixed.
 * Uses array filtering to cleanly handle the optional prefix.
 *
 * @param prefix - Optional string to prepend to the UUID.
 * @returns A string in the format "prefix-UUID" or just "UUID".
 */
export const createUUID = (prefix?: string) => {
  return [prefix, v7()].filter(Boolean).join('-');
};

/**
 *
 * @param sizeInBytes
 * @returns
 */
export const formatFileSize = (sizeInBytes: number): string => {
  if (sizeInBytes < 1024) return `${sizeInBytes} bytes`;
  else if (sizeInBytes < 1024 * 1024) return `${(sizeInBytes / 1024).toFixed(2)} KB`;
  else if (sizeInBytes < 1024 * 1024 * 1024) return `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`;
  else return `${(sizeInBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};
