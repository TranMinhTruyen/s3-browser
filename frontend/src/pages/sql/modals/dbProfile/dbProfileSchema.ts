import z from 'zod';
import { DEFAULT_PROFILE_COLOR } from '@/components/modals/modalColors';
import type { DbProfile, DbType, SslMode } from '@/pages/sql/stores/dbProfileStore';

export const SSL_MODES: SslMode[] = ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'];
const DEFAULT_PG_PORT = 5432;
const MIN_PORT = 1;
const MAX_PORT = 65535;

/** Form values; `port` is a string while the user is typing in the NumberInput. */
export type DbProfileForm = {
  name: string;
  color: string;
  dbType: DbType;
  host: string;
  port: number | string;
  database: string;
  username: string;
  password: string;
  sslMode: SslMode;
  filePath: string;
};

const text = z.string().trim();
const required = text.nonempty('V000001');

/**
 * Validation of the profile form. `isNameTaken` tells whether another profile already uses the name;
 * only the fields of the selected DB type are checked.
 */
export const createDbProfileSchema = (isNameTaken: (name: string) => boolean) =>
  z
    .object({
      name: required,
      color: text,
      dbType: z.enum(['postgresql', 'sqlite']),
      host: text,
      port: z.union([z.number(), z.string()]),
      database: text,
      username: text,
      password: z.string(),
      sslMode: z.enum(SSL_MODES),
      filePath: text,
    })
    .superRefine((value, ctx) => {
      const fail = (path: keyof DbProfileForm, message: string) =>
        ctx.addIssue({ code: 'custom', path: [path], message });

      if (isNameTaken(value.name)) fail('name', 'V000013');

      if (value.dbType === 'sqlite') {
        if (!value.filePath) fail('filePath', 'V000001');
        return;
      }
      if (!value.host) fail('host', 'V000001');
      if (!value.database) fail('database', 'V000001');
      if (!value.username) fail('username', 'V000001');

      const port = value.port === '' ? Number.NaN : Number(value.port);
      if (value.port === '') fail('port', 'V000001');
      else if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
        fail('port', `V000003:${MIN_PORT},${MAX_PORT}`);
      }
    });

/** Empty form with the given default profile name. */
export const getDefaultDbProfileForm = (name: string): DbProfileForm => ({
  name,
  color: DEFAULT_PROFILE_COLOR,
  dbType: 'postgresql',
  host: '',
  port: DEFAULT_PG_PORT,
  database: '',
  username: '',
  password: '',
  sslMode: 'prefer',
  filePath: '',
});

/** Form values of a saved profile. */
export const toFormValues = (profile: DbProfile): DbProfileForm => ({
  ...profile,
  port: profile.port || DEFAULT_PG_PORT,
});

/** Profile to store: only the fields of the selected DB type are kept, the others are emptied. */
export const toDbProfile = (values: DbProfileForm, id: string, isConnected: boolean): DbProfile => {
  const base = { id, name: values.name.trim(), color: values.color, dbType: values.dbType, isConnected };
  return values.dbType === 'sqlite'
    ? {
        ...base,
        host: '',
        port: 0,
        database: '',
        username: '',
        password: '',
        sslMode: 'prefer',
        filePath: values.filePath.trim(),
      }
    : {
        ...base,
        host: values.host.trim(),
        port: Number(values.port),
        database: values.database.trim(),
        username: values.username.trim(),
        password: values.password,
        sslMode: values.sslMode,
        filePath: '',
      };
};
