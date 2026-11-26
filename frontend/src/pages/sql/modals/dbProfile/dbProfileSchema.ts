import type { DbProfileInput } from '@wails/S3Browser/models';
import z from 'zod';
import { DEFAULT_PROFILE_COLOR } from '@/components/modals/modalColors';
import type { DbProfile, Provider, SslMode } from '@/pages/sql/stores/dbProfileStore';

export const SSL_MODES: SslMode[] = ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'];
const DEFAULT_PG_PORT = 5432;
const MIN_PORT = 1;
const MAX_PORT = 65535;

/** Giá trị form; `port` là chuỗi trong lúc người dùng nhập vào NumberInput. */
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
 * Kiểm tra dữ liệu của form profile. `isNameTaken` cho biết profile khác đã dùng tên này chưa;
 * chỉ kiểm tra các trường thuộc loại DB đang chọn.
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

/** Form trống với tên profile mặc định đã cho. */
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

/** Giá trị form của profile đã lưu; mật khẩu không bao giờ được tải nên trường này luôn bắt đầu trống. */
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

/** Dữ liệu gửi backend: chỉ gửi các trường cấu hình của provider đang chọn. `id` được đặt khi chỉnh sửa. */
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
