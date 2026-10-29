// Header colors shared by modals: info style (also the default header) and warning style.
// light-dark() follows the Mantine color scheme; only theme variables are used, so no hard-coded hex.
export const INFO_BG_COLOR = 'light-dark(var(--mantine-color-blue-1), var(--mantine-color-blue-9))';
export const INFO_COLOR = 'light-dark(var(--mantine-color-indigo-8), var(--mantine-color-blue-3))';
export const WARNING_BG_COLOR = 'light-dark(var(--mantine-color-lime-1), var(--mantine-color-yellow-9))';
export const WARNING_COLOR = 'light-dark(var(--mantine-color-yellow-6), var(--mantine-color-yellow-4))';

/** Default color of a new connection profile. Stored as profile data, so it stays a plain hex value. */
export const DEFAULT_PROFILE_COLOR = '#d0ebff';
