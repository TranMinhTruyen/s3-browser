export function formatDimension(value: string | number): string {
  if (typeof value === 'string' && (value.includes('px') || value.includes('%'))) {
    return value;
  }
  if (typeof value === 'number') {
    return `${value}px`;
  }
  return value;
}
