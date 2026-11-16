import { createElement } from 'react';
import { toast } from 'sonner';
import i18n from '@/locales/i18n';
import { useDbProfileStore } from '@/pages/sql/stores/dbProfileStore';

// TODO(sprint backend DB): remove notifyNoBackend once the actions below call the real backend.
/** Toast for actions that need the DB backend, which does not exist yet. */
export const notifyNoBackend = () => {
  toast.info(i18n.t('sqlNavbar:toast.noBackend'));
};

const MAX_SQL_LENGTH = 500;

/** Cuts long SQL for a toast, adding an ellipsis when something was removed. */
export const truncateSql = (sql: string) => (sql.length > MAX_SQL_LENGTH ? `${sql.slice(0, MAX_SQL_LENGTH)}…` : sql);

// TODO(sprint backend DB): replace this fake run with the real query execution.
/** Fake run for Execute / Ctrl+E: toasts the profile name and the SQL (cut short). Warns when it cannot run. */
export const runSql = (profileId: string | null | undefined, sql: string) => {
  const profile = useDbProfileStore.getState().getDbProfileById(profileId);
  if (!profile) {
    toast.warning(i18n.t('sqlTab:toast.noProfile'));
    return;
  }
  if (!sql.trim()) {
    toast.warning(i18n.t('sqlTab:toast.emptySql'));
    return;
  }
  // Monospace on purpose (unlike the editor): a short quoted code block reads better with even columns.
  toast.info(profile.name, {
    description: createElement(
      'span',
      {
        style: {
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 10,
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          fontFamily: 'var(--mantine-font-family-monospace)',
        },
      },
      truncateSql(sql)
    ),
  });
};
