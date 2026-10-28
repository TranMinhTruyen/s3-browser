import type { ConnectionProfileOutput } from '@wails/S3Browser/models';
import z from 'zod';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';

/** Schema used when only saving a profile (the secret key is optional). */
export const profileSchema = z.object({
  name: z.string().trim(),
  color: z.string().trim(),
  provider: z.string().trim(),
  endpoint: z.string().trim().nonempty('V000001'),
  region: z.string().trim().nonempty('V000001'),
  accessKey: z.string().trim().nonempty('V000001'),
  secretKey: z.string().trim(),
  pathStyle: z.boolean(),
  savePassword: z.boolean(),
  autoConnect: z.boolean(),
});

/** Schema used when connecting or testing a connection (the secret key is required). */
export const connectSchema = profileSchema.extend({
  secretKey: z.string().trim().nonempty('V000001'),
});

export interface ConnectionInfo extends z.infer<typeof connectSchema> {}

export type ConnectModalProps = {
  mode?: 'connect' | 'manualconnect' | 'createProfile' | 'editProfile';
  connectionProfile?: ConnectionProfileOutput;
};

/** Builds the empty form values, with the given default profile name. */
export const getDefaultConnectionInfo = (name: string): ConnectionInfo =>
  connectSchema
    .default({
      name,
      color: INFO_BG_COLOR,
      provider: 'aws',
      endpoint: '',
      region: '',
      accessKey: '',
      secretKey: '',
      pathStyle: false,
      savePassword: false,
      autoConnect: false,
    })
    .parse(undefined);
