import { Box, Card, Divider, Group, Modal, Stack, Text, Title } from '@mantine/core';
import { DroppedFile } from '@wails/S3Browser/models/bucket';
import { File, TriangleAlert } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { createMantineModal, ModalProps } from '@/common/utils/modalUtils';
import { formatFileSize, formatStringJson } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';
import classes from '@/pages/object/page.module.css';

type UploadLimitModalProps = ModalProps & {
  // Files that will be uploaded (already trimmed to max, or just the largest file).
  files: DroppedFile[];
  // The drop had more than `max` files, so only the first `max` were kept.
  truncated: boolean;
  max: number;
  // Size in bytes above which a file counts as large.
  largeFileSize: number;
  // Set when a large file exists: only this file is uploaded.
  largeFile?: DroppedFile;
};

// Last path segment; dropped paths use "\" on Windows and "/" elsewhere.
const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

/** Asks the user to confirm a trimmed drop; resolves true to upload `files` only. */
export default createMantineModal<UploadLimitModalProps, boolean>(props => {
  const {
    files,
    truncated,
    max,
    largeFileSize,
    largeFile,
    mantine,
    size = 'xl',
    centered = true,
    ...restProps
  } = props;

  const { t } = useTranslation('uploadLimitModal');

  const onClickUpload = useCallback(() => {
    mantine.handler.resolve(true);
    mantine.handler.hide();
  }, [mantine.handler]);

  const onClickCancel = useCallback(() => {
    mantine.handler.resolve(false);
    mantine.handler.hide();
  }, [mantine.handler]);

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
            {truncated && <Text>{formatStringJson(t('truncatedDescription'), { max })}</Text>}
            {largeFile && (
              <Text>{formatStringJson(t('largeFileDescription'), { limit: formatFileSize(largeFileSize) })}</Text>
            )}
            {!largeFile && <Text>{t('listDescription')}</Text>}
            <Stack gap="8px">
              {files.map(({ path, relKey, size: fileSize }) => (
                <Card
                  key={path}
                  padding="8px"
                  orientation="horizontal"
                  withBorder
                  miw={0}
                  style={{ overflow: 'hidden' }}
                >
                  <Card.Section
                    inheritPadding
                    px="8px"
                    withBorder
                    style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <File size="20px" />
                  </Card.Section>
                  <Card.Section
                    inheritPadding
                    px="md"
                    py="xs"
                    style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}
                  >
                    <Stack gap="4px" w="100%" miw={0}>
                      <Text size="lg" fw={500} truncate="end" title={path}>
                        {baseName(path)}
                      </Text>
                      <Group gap="xl" wrap="nowrap" align="flex-start">
                        <Box miw="80px" style={{ flexShrink: 0 }}>
                          <Text span className={classes.label}>
                            {t('size')}
                          </Text>
                          <Text>{formatFileSize(fileSize)}</Text>
                        </Box>
                        <Box miw={0} style={{ flex: 1 }}>
                          <Text span className={classes.label}>
                            {t('key')}
                          </Text>
                          <Text truncate="end" title={relKey}>
                            {relKey}
                          </Text>
                        </Box>
                      </Group>
                    </Stack>
                  </Card.Section>
                </Card>
              ))}
            </Stack>
          </Stack>
        </Modal.Body>

        <Divider />

        <Group p="8px" justify="space-between">
          <Button onClick={onClickUpload}>{t('upload')}</Button>
          <Button onClick={onClickCancel} color="red">
            {t('common:button.cancel')}
          </Button>
        </Group>
      </Modal.Content>
    </Modal.Root>
  );
});
