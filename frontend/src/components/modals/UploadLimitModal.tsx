import { Divider, Group, List, Modal, Stack, Text, Title } from '@mantine/core';
import { File, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { createMantineModal, ModalProps } from '@/common/utils/modalUtils';
import { formatStringJson } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';

type UploadLimitModalProps = ModalProps & {
  // Full local paths of the files that will be uploaded (already trimmed to max).
  files: string[];
  // How many files were dropped.
  total: number;
  max: number;
};

// Last path segment; dropped paths use "\" on Windows and "/" elsewhere.
const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

/** Warns that a drop has more files than one upload accepts; resolves true to upload `files` only. */
export default createMantineModal<UploadLimitModalProps, boolean>(props => {
  const { files, total, max, mantine, size = 'md', centered = true, ...restProps } = props;

  const { t } = useTranslation('uploadLimitModal');

  return (
    <Modal.Root {...mantine.props} size={size} centered={centered} {...restProps}>
      <Modal.Overlay />
      <Modal.Content>
        <Modal.Header
          pos="relative"
          p="8px"
          mih="0px"
          style={{ justifyContent: 'flex-end', backgroundColor: '#f6ffd0' }}
        >
          <Group gap="xs" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            <TriangleAlert color="#dfc21e" />
            <Title order={4} style={{ color: '#dfc21e' }}>
              {t('title')}
            </Title>
          </Group>
          <Modal.CloseButton size="md" />
        </Modal.Header>

        <Divider />

        <Modal.Body p="8px">
          <Stack gap="8px">
            <Text>{formatStringJson(t('description'), { total, max })}</Text>
            <List spacing="4px" icon={<File size="16px" />} center>
              {files.map(path => (
                <List.Item key={path} styles={{ itemWrapper: { minWidth: 0 }, itemLabel: { minWidth: 0 } }}>
                  <Text fw={500} truncate="end">
                    {baseName(path)}
                  </Text>
                  <Text size="xs" c="dimmed" truncate="end" title={path}>
                    {path}
                  </Text>
                </List.Item>
              ))}
            </List>
          </Stack>
        </Modal.Body>

        <Divider />

        <Group p="8px" justify="space-between">
          <Button
            onClick={() => {
              mantine.handler.resolve(true);
              mantine.handler.hide();
            }}
          >
            {t('upload')}
          </Button>
          <Button
            onClick={() => {
              mantine.handler.resolve(false);
              mantine.handler.hide();
            }}
            color="red"
          >
            {t('common:button.cancel')}
          </Button>
        </Group>
      </Modal.Content>
    </Modal.Root>
  );
});
