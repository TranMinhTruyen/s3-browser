import type { DbProfileInput } from '@wails/S3Browser/models';
import z from 'zod';
import { DEFAULT_PROFILE_COLOR } from '@/components/modals/modalColors';
import type { DbProfile, Provider, SslMode } from '@/pages/sql/stores/dbProfileStore';

export const SSL_MODES: SslMode[] = ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'];
const DEFAULT_PG_PORT = 5432;
const MIN_PORT = 1;
const MAX_PORT = 65535;

/** Form values; `port` is a string while the user is typing in the NumberInput. */
export type DbProfileForm = {
  name: string;
  color: string;
  provider: Provider;
  host: string;
  port: number | string;
  database: string;
  username: string;
  password: string;
  sslMode: SslMode;
  filePath: string;
  readOnly: boolean;
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
      provider: z.enum(['postgres', 'sqlite']),
      host: text,
      port: z.union([z.number(), z.string()]),
      database: text,
      username: text,
      password: z.string(),
      sslMode: z.enum(SSL_MODES),
      filePath: text,
      readOnly: z.boolean(),
    })
    .superRefine((value, ctx) => {
      const fail = (path: keyof DbProfileForm, message: string) =>
        ctx.addIssue({ code: 'custom', path: [path], message });

      if (isNameTaken(value.name)) fail('name', 'V000013');

      if (value.provider === 'sqlite') {
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
  provider: 'postgres',
  host: '',
  port: DEFAULT_PG_PORT,
  database: '',
  username: '',
  password: '',
  sslMode: 'prefer',
  filePath: '',
  readOnly: false,
});

/** Form values of a saved profile; the password is never loaded, so the field starts empty. */
export const toFormValues = (profile: DbProfile): DbProfileForm => {
  const { config } = profile;
  return {
    name: profile.name,
    color: profile.color,
    provider: profile.provider,
    host: config.host ?? '',
    port: config.port || DEFAULT_PG_PORT,
    database: config.database ?? '',
    username: config.username ?? '',
    password: '',
    sslMode: (config.sslMode as SslMode | undefined) ?? 'prefer',
    filePath: config.filePath ?? '',
    readOnly: config.readOnly ?? false,
  };
};

/** Backend input: only the config fields of the selected provider are sent. `id` is set when editing. */
export const toDbProfileInput = (values: DbProfileForm, id?: string): DbProfileInput => {
  const base = { id, name: values.name.trim(), color: values.color, provider: values.provider };
  return values.provider === 'sqlite'
    ? { ...base, config: { filePath: values.filePath.trim(), readOnly: values.readOnly } }
    : {
        ...base,
        config: {
          host: values.host.trim(),
          port: Number(values.port),
          database: values.database.trim(),
          username: values.username.trim(),
          sslMode: values.sslMode,
        },
        secret: values.password,
      };
};
