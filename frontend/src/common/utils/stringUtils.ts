import { TFunction } from 'i18next';
import { v7 } from 'uuid';
import i18n from '@/locales/i18n';

/**
 * Checks whether a string is null, undefined or empty (whitespace is not empty).
 *
 * @param value - string to check.
 * @returns true when there is no text.
 */
export function isNullOrEmpty(value?: string | null): value is null | undefined | '' {
  return value == null || value === '';
}

/**
 * Replaces positional placeholders `{0}`, `{1}`, ... with the arguments.
 * A placeholder without a matching (non-null) argument is left as is.
 *
 * @param template - text containing `{n}` placeholders.
 * @param args - values for `{0}`, `{1}`, ...
 * @returns the formatted text.
 */
export function formatString(template: string, ...args: (string | number | bigint | null | undefined)[]): string {
  return template.replace(/{(\d+)}/g, (match, index) => {
    const paramIndex = parseInt(index, 10);
    return args[paramIndex] !== undefined && args[paramIndex] !== null ? args[paramIndex].toString() : match;
  });
}

/**
 * Replaces named placeholders `{key}` / `{a.b}` with values from `params`.
 * A placeholder whose value is missing is left as is.
 *
 * @param template - text containing `{key}` placeholders.
 * @param params - values by key; nested values are read with dot paths.
 * @returns the formatted text, or '' when the template is empty.
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
 * Turns a validation code (`V000002:255`) into a translated message.
 * The label is `{0}`; the comma separated values after `:` are `{1}`, `{2}`, ...
 *
 * @param rawError - validation code with optional params.
 * @param label - field label used as `{0}`.
 * @param t - translate function (defaults to the global i18n).
 * @returns the translated message, or the raw error when the translation is not a string.
 */
export function formatFieldError(rawError: string, label: React.ReactNode, t: TFunction = i18n.t): string {
  const [code, paramsStr] = rawError.split(':');
  const template = t(code, { defaultValue: code });
  if (typeof template !== 'string') return rawError;

  const params = [String(label), ...(paramsStr ? paramsStr.split(',') : [])];
  return formatString(template, ...params);
}

/**
 * Generates a time-ordered UUID (v7), optionally prefixed.
 *
 * @param prefix - optional text put before the UUID.
 * @returns "prefix-UUID" or just "UUID".
 */
export const createUUID = (prefix?: string) => [prefix, v7()].filter(Boolean).join('-');

/**
 * Formats a byte count as bytes / KiB / MiB / GiB (1024-based, 2 decimals above bytes).
 *
 * @param sizeInBytes - size in bytes.
 * @returns the readable size.
 */
export const formatFileSize = (sizeInBytes: number): string => {
  if (sizeInBytes < 1024) return `${sizeInBytes} bytes`;
  else if (sizeInBytes < 1024 * 1024) return `${(sizeInBytes / 1024).toFixed(2)} KiB`;
  else if (sizeInBytes < 1024 * 1024 * 1024) return `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MiB`;
  else return `${(sizeInBytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
};
