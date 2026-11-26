import { Center, Divider, Group, Loader, Modal, Paper, Stack, Text, Title } from '@mantine/core';
import { GetBucketPolicy, PutBucketPolicy } from '@wails/S3Browser/internal/handlers/buckethandler';
import { BucketPolicyOutput } from '@wails/S3Browser/models/bucket';
import { ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { callIPC } from '@/common/utils/ipcUtils';
import { createMantineModal, ModalProps } from '@/common/utils/modalUtils';
import Button from '@/components/buttons/Button';
import CloseButton from '@/components/buttons/CloseButton';
import TruncatedText from '@/components/display/TruncatedText';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';
import BucketPolicyInput from '@/pages/s3/components/BucketPolicyInput';
import { type PolicyMode, validatePolicy } from '@/pages/s3/utils/bucketUtils';

type BucketPolicyModalProps = ModalProps & {
  connectionId: string;
  profileName?: string;
  bucket: string;
  // Được gọi với mode đã lưu sau khi ghi policy.
  onSaved?: (mode: PolicyMode) => void;
};

/** Hiển thị và thay đổi quyền truy cập bucket thành riêng tư / công khai chỉ đọc / policy JSON tùy chỉnh. */
export default createMantineModal<BucketPolicyModalProps, boolean>(
  props => {
    const { connectionId, profileName, bucket, onSaved, mantine, size = 'md', centered = true, ...rest } = props;

    const { t } = useTranslation('bucketPolicyModal');

    // undefined khi đang tải, null nếu tải thất bại.
    const [current, setCurrent] = useState<BucketPolicyOutput | null>();
    const [mode, setMode] = useState<PolicyMode>('private');
    const [policy, setPolicy] = useState('');
    // Controller của thao tác lưu đang chạy, bị hủy khi modal đóng.
    const saveCtrl = useRef<AbortController>(null);

    const applyOutput = useCallback((output: BucketPolicyOutput) => {
      setCurrent(output);
      setMode(output.mode as PolicyMode);
      setPolicy(output.policy);
    }, []);

    // Đóng modal bằng bất kỳ cách nào cũng hủy lượt tải đang chạy để kết quả về muộn không cập nhật state.
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
    const canSave = !readOnly && !validatePolicy(mode, policy) && (mode !== 'custom' || !!policy);

    const onChangePolicy = useCallback((value: string) => setPolicy(value), []);

    const onClickSave = useCallback(async () => {
      saveCtrl.current = new AbortController();
      const { signal } = saveCtrl.current;
      const output = await callIPC(
        PutBucketPolicy,
        [{ connectionId, profileName, bucket, mode, policy: mode === 'custom' ? policy : undefined }],
        { signal }
      );
      // Khi thất bại, callIPC đã hiện lỗi và form giữ nguyên nội dung người dùng đã nhập.
      if (signal.aborted || !output) return;
      applyOutput(output);
      onSaved?.(output.mode as PolicyMode);
    }, [connectionId, profileName, bucket, mode, policy, applyOutput, onSaved]);

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
            p="0.5rem"
            mih="0"
            style={{ justifyContent: 'flex-end', backgroundColor: INFO_BG_COLOR }}
          >
            <Group
              gap="xs"
              style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
            >
              <ShieldCheck />
              <Title order={4}>{t('title')}</Title>
            </Group>
            <CloseButton tooltip={t('common:button.close')} onClick={mantine.props.onClose} />
          </Modal.Header>

          <Divider />

          <Modal.Body p="0.5rem">
            <Paper withBorder p="0.5rem">
              {current === undefined ? (
                <Center py="md">
                  <Loader size="sm" />
                </Center>
              ) : (
                <Stack gap="0.5rem">
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
                  <BucketPolicyInput
                    mode={mode}
                    policy={policy}
                    readOnly={readOnly}
                    onChangeMode={setMode}
                    onChangePolicy={onChangePolicy}
                  />
                </Stack>
              )}
            </Paper>
          </Modal.Body>

          <Divider />

          <Group p="0.5rem" justify="space-between" wrap="nowrap">
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
  },
  { cancelValue: false }
);
