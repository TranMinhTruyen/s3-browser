import { Center, Divider, Group, Loader, Modal, Paper, Stack, Text, Title } from '@mantine/core';
import { GetBucketPolicy, PutBucketPolicy } from '@wails/S3Browser/internal/handlers/buckethandler';
import { BucketPolicyOutput } from '@wails/S3Browser/models/bucket';
import { ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { callIPC } from '@/common/utils/ipcUtils';
import { createMantineModal, ModalProps } from '@/common/utils/modalUtils';
import Button from '@/components/buttons/Button';
import TruncatedText from '@/components/display/TruncatedText';
import FieldInput from '@/components/inputs/FieldInput';
import SegmentedControl from '@/components/inputs/SegmentedControl';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';

type BucketPolicyModalProps = ModalProps & {
  connectionId: string;
  profileName?: string;
  bucket: string;
};

type PolicyMode = 'private' | 'public' | 'custom';
const MODES: PolicyMode[] = ['private', 'public', 'custom'];

const isValidJson = (text: string) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

/** Shows and changes the access of a bucket as private / public read-only / custom policy JSON. */
export default createMantineModal<BucketPolicyModalProps, boolean>(props => {
  const { connectionId, profileName, bucket, mantine, size = 'md', centered = true, ...rest } = props;

  const { t } = useTranslation('bucketPolicyModal');

  // undefined while loading, null when it failed to load.
  const [current, setCurrent] = useState<BucketPolicyOutput | null>();
  const [mode, setMode] = useState<PolicyMode>('private');
  const [policy, setPolicy] = useState('');
  // Controller of the running save, aborted when the modal closes.
  const saveCtrl = useRef<AbortController>(null);

  const applyOutput = useCallback((output: BucketPolicyOutput) => {
    setCurrent(output);
    setMode(output.mode as PolicyMode);
    setPolicy(output.policy);
  }, []);

  // Closing the modal (any way) cancels the load in flight, so a late result never sets state.
  useEffect(() => {
    const loadCtrl = new AbortController();
    callIPC(GetBucketPolicy, [{ connectionId, profileName, bucket }], { signal: loadCtrl.signal }).then(output => {
      if (loadCtrl.signal.aborted) return;
      if (output) applyOutput(output);
      else setCurrent(null);
    });
    return () => loadCtrl.abort();
  }, [connectionId, profileName, bucket, applyOutput]);

  const readOnly = !current || current.editDenied;
  const policyError = mode === 'custom' && policy && !isValidJson(policy) ? 'V000004' : null;
  const canSave = !readOnly && !policyError && (mode !== 'custom' || !!policy);

  const modeOptions = useMemo(() => MODES.map(value => ({ value, label: t(`mode.${value}`) })), [t]);

  const onChangePolicy = useCallback((value: string) => setPolicy(value), []);
  const onChangeMode = useCallback((value: string) => setMode(value as PolicyMode), []);

  const onClickSave = useCallback(async () => {
    saveCtrl.current = new AbortController();
    const { signal } = saveCtrl.current;
    const output = await callIPC(
      PutBucketPolicy,
      [{ connectionId, profileName, bucket, mode, policy: mode === 'custom' ? policy : undefined }],
      { signal }
    );
    // On failure callIPC already showed the error and the form keeps what the user typed.
    if (signal.aborted || !output) return;
    applyOutput(output);
  }, [connectionId, profileName, bucket, mode, policy, applyOutput]);

  useEffect(() => () => saveCtrl.current?.abort(), []);

  const onClickCancel = useCallback(() => {
    mantine.handler.resolve(false);
    mantine.handler.hide();
  }, [mantine.handler]);

  return (
    <Modal.Root {...mantine.props} size={size} centered={centered} {...rest}>
      <Modal.Overlay />
      <Modal.Content>
        <Modal.Header
          pos="relative"
          p="8px"
          mih="0px"
          style={{ justifyContent: 'flex-end', backgroundColor: INFO_BG_COLOR }}
        >
          <Group gap="xs" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            <ShieldCheck />
            <Title order={4}>{t('title')}</Title>
          </Group>
          <Modal.CloseButton size="md" aria-label={t('common:button.close')} />
        </Modal.Header>

        <Divider />

        <Modal.Body p="8px">
          <Paper withBorder p="8px">
            {current === undefined ? (
              <Center py="md">
                <Loader size="sm" />
              </Center>
            ) : (
              <Stack gap="8px">
                <div>
                  <Text size="sm" c="dimmed">
                    {t('label.bucket')}
                  </Text>
                  <TruncatedText fw={500}>{bucket}</TruncatedText>
                </div>
                {current === null ? <Text c="var(--mantine-color-red-filled)">{t('warning.loadError')}</Text> : null}
                {current?.editDenied ? (
                  <Text c="var(--mantine-color-orange-filled)">{t('warning.editDenied')}</Text>
                ) : null}
                {current?.publicBlocked ? (
                  <Text c="var(--mantine-color-orange-filled)">{t('warning.publicBlocked')}</Text>
                ) : null}
                <SegmentedControl
                  fullWidth
                  data={modeOptions}
                  value={mode}
                  disabled={readOnly}
                  onChange={onChangeMode}
                />
                <Text size="sm" c="dimmed">
                  {t(`hint.${mode}`)}
                </Text>
                {mode === 'custom' ? (
                  <FieldInput
                    type="json"
                    label={t('label.policy')}
                    autosize
                    minRows={8}
                    maxRows={16}
                    readOnly={readOnly}
                    value={policy}
                    error={policyError}
                    onChange={onChangePolicy}
                  />
                ) : null}
              </Stack>
            )}
          </Paper>
        </Modal.Body>

        <Divider />

        <Group p="8px" justify="space-between" wrap="nowrap">
          <Button onClick={onClickCancel} color="red">
            {t('common:button.cancel')}
          </Button>
          <Button onClick={onClickSave} disabled={!canSave}>
            {t('save')}
          </Button>
        </Group>
      </Modal.Content>
    </Modal.Root>
  );
});
