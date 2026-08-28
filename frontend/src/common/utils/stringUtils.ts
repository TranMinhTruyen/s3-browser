/**
 * Format string with params.
 *
 * @param template
 * @param params
 * @returns
 */
export const formatString = (template: string, ...args: (string | number | bigint | null | undefined)[]): string => {
  return template.replace(/{(\d+)}/g, (match, index) => {
    const paramIndex = parseInt(index, 10);
    return args[paramIndex] !== undefined && args[paramIndex] !== null ? args[paramIndex].toString() : match;
  });
};
