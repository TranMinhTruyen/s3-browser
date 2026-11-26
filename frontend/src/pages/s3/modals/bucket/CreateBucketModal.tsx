import { Divider, Group, Modal, Paper, Stack, Text, Title } from '@mantine/core';
import { CreateBucket } from '@wails/S3Browser/internal/handlers/buckethandler';
import { FolderPlus } from 'lucide-react';
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { callIPC } from '@/common/utils/ipcUtils';
import { createMantineModal, ModalProps } from '@/common/utils/modalUtils';
import Button from '@/components/buttons/Button';
import CloseButton from '@/components/buttons/CloseButton';
import FieldInput from '@/components/inputs/FieldInput';
import { INFO_BG_COLOR } from '@/components/modals/modalColors';
import BucketPolicyInput from '@/pages/s3/components/BucketPolicyInput';
import RegionCombobox from '@/pages/s3/components/RegionCombobox';
import { type PolicyMode, validateBucketName, validatePolicy } from '@/pages/s3/utils/bucketUtils';

type CreateBucketModalProps = ModalProps & {
  connectionId: string;
  profileName?: string;
  // Chỉ AWS thật mới cho phép chọn region của bucket mới.
  withRegion: boolean;
  defaultRegion?: string;
};

/** Yêu cầu nhập tên bucket mới (và region trên AWS); trả về true khi tạo xong, false nếu hủy. */
export default createMantineModal<CreateBucketModalProps, boolean>(
  props => {
    const {
      connectionId,
      profileName,
      withRegion,
      defaultRegion,
      mantine,
      size = 'md',
      centered = true,
      ...rest
    } = props;

    const { t } = useTranslation('createBucketModal');

    const [name, setName] = useState('');
    const [region, setRegion] = useState<string | null>(defaultRegion || null);
    const [mode, setMode] = useState<PolicyMode>('private');
    const [policy, setPolicy] = useState('');
    const ctrl = useRef<AbortController>(null);

    // Đóng modal bằng cách nào cũng hủy thao tác tạo bucket đang chạy.
    useEffect(() => () => ctrl.current?.abort(), []);

    // Không báo lỗi khi tên đang trống trong lúc nhập; chỉ vô hiệu hóa nút Tạo.
    const error = name ? validateBucketName(name) : null;

    const onChangeName = useCallback((e: ChangeEvent<HTMLInputElement>) => setName(e.currentTarget.value), []);

    const onChangePolicy = useCallback((value: string) => setPolicy(value), []);

    const onClickCreate = useCallback(async () => {
      if (validateBucketName(name)) return;
      ctrl.current = new AbortController();
      const { signal } = ctrl.current;
      let created = false;
      await callIPC(
        CreateBucket,
        [
          {
            connectionId,
            profileName,
            bucket: name,
            region: withRegion ? (region ?? undefined) : undefined,
            mode: mode !== 'private' ? mode : undefined,
            policy: mode === 'custom' ? policy : undefined,
          },
        ],
        {
          signal,
          resolveAction: () => {
            created = true;
          },
        }
      );
      // Khi thất bại, callIPC đã hiện lỗi; giữ modal mở để người dùng sửa tên.
      if (signal.aborted || !created) return;
      mantine.handler.resolve(true);
      mantine.handler.hide();
    }, [name, connectionId, profileName, withRegion, region, mode, policy, mantine.handler]);

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
              <FolderPlus />
              <Title order={4}>{t('title')}</Title>
            </Group>
            <CloseButton tooltip={t('common:button.close')} onClick={mantine.props.onClose} />
          </Modal.Header>

          <Divider />

          <Modal.Body p="0.5rem">
            <Paper withBorder p="0.5rem">
              <Stack gap="0.5rem">
                <FieldInput
                  data-autofocus
                  label={t('label.name')}
                  description={t('hint.name')}
                  placeholder={t('placeholder.name')}
                  withAsterisk
                  value={name}
                  error={error}
                  onChange={onChangeName}
                />
                {withRegion ? <RegionCombobox value={region} onChange={setRegion} /> : null}
                <Text size="sm" fw={500}>
                  {t('label.permission')}
                </Text>
                {withRegion && mode !== 'private' ? (
                  <Text size="sm" c="var(--mantine-color-orange-filled)">
                    {t('warning.publicAccessBlock')}
                  </Text>
                ) : null}
                <BucketPolicyInput mode={mode} policy={policy} onChangeMode={setMode} onChangePolicy={onChangePolicy} />
              </Stack>
            </Paper>
          </Modal.Body>

          <Divider />

          <Group p="0.5rem" justify="space-between" wrap="nowrap">
            <Button onClick={onClickCancel} color="red">
              {t('common:button.cancel')}
            </Button>
            <Button
              onClick={onClickCreate}
              disabled={!name || !!error || (mode === 'custom' && (!policy || !!validatePolicy(mode, policy)))}
            >
              {t('create')}
            </Button>
          </Group>
        </Modal.Content>
      </Modal.Root>
    );
  },
  { cancelValue: false }
);
