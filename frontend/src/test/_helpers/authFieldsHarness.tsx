import { useForm } from '@mantine/form';
import { screen } from '@testing-library/react';
import { type ReactNode, useEffect } from 'react';
import { type ConnectionInfo, getDefaultConnectionInfo } from '@/components/modals/connect/connectSchema';

export type Patch = Partial<Omit<ConnectionInfo, 'authConfig'>> & {
  authConfig?: Partial<ConnectionInfo['authConfig']>;
};

export const values = (patch: Patch = {}): ConnectionInfo => {
  const base = getDefaultConnectionInfo('p');
  return { ...base, ...patch, authConfig: { ...base.authConfig, ...patch.authConfig } } as ConnectionInfo;
};

export const input = (name: RegExp | string) => screen.getByLabelText(name, { selector: 'input:not([type=radio])' });
export const queryInput = (name: RegExp | string) =>
  screen.queryByLabelText(name, { selector: 'input:not([type=radio])' });

/** Mantine puts the asterisk in the label of a required field. */
export const starred = (el: HTMLElement) => !!(el as HTMLInputElement).labels?.[0]?.textContent?.includes('*');

export type Probe = { form?: ReturnType<typeof useForm<ConnectionInfo>> };

export function Harness({
  initial,
  probe,
  children,
}: {
  initial: ConnectionInfo;
  probe: Probe;
  children: (form: ReturnType<typeof useForm<ConnectionInfo>>) => ReactNode;
}) {
  const form = useForm<ConnectionInfo>({ mode: 'uncontrolled', initialValues: initial });
  useEffect(() => {
    Object.assign(probe, { form });
  }, [probe, form]);
  return <>{children(form)}</>;
}
