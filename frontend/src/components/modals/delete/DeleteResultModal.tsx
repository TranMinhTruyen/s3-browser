import { Accordion, Badge, Divider, Group, Modal, Paper, Stack, Text, Title } from '@mantine/core';
import { Info } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { createMantineModal, ModalProps } from '@/common/utils/modalUtils';
import { formatStringJson } from '@/common/utils/stringUtils';
import Button from '@/components/buttons/Button';
import CloseButton from '@/components/buttons/CloseButton';
import DeleteKeyList, { DeleteKeyRow } from '@/components/modals/delete/DeleteKeyList';
import { INFO_BG_COLOR, INFO_COLOR } from '@/components/modals/modalColors';

type DeleteResultModalProps = ModalProps & {
  // Number of keys deleted and failed (the whole count, even if `failures` was cut).
  deleted: number;
  failed: number;
  // Deleted keys; omitted when the backend only counts them (folder delete).
  deletedKeys?: string[];
  // Failed keys with their reason, possibly only the first ones.
  failures: { key: string; error: string }[];
};

/** Shows how many keys a delete removed and which ones failed (or succeeded) in an accordion. */
export default createMantineModal<DeleteResultModalProps, void>(props => {
  const { deleted, failed, deletedKeys, failures, mantine, size = 'xl', centered = true, ...restProps } = props;

  const { t } = useTranslation('deleteResultModal');

  const failureRows = useMemo<DeleteKeyRow[]>(() => failures.map(f => ({ key: f.key, error: f.error })), [failures]);
  const deletedRows = useMemo<DeleteKeyRow[]>(() => (deletedKeys ?? []).map(key => ({ key })), [deletedKeys]);

  const hasFailures = failureRows.length > 0;
  const hasDeletedRows = deletedRows.length > 0;

  const onClickOk = useCallback(() => {
    mantine.handler.resolve();
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
          style={{ justifyContent: 'flex-end', backgroundColor: INFO_BG_COLOR }}
        >
          <Group gap="xs" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            <Info color={INFO_COLOR} />
            <Title order={4} style={{ color: INFO_COLOR }}>
              {t('title')}
            </Title>
          </Group>
          <CloseButton tooltip={t('common:button.close')} onClick={mantine.props.onClose} />
        </Modal.Header>

        <Divider />

        <Modal.Body p="8px">
          <Paper withBorder p="8px">
            <Stack gap="8px">
              <Group gap="8px">
                <Badge variant="light" color="var(--mantine-color-green-6)" size="lg">
                  {formatStringJson(t('deletedCount'), { count: deleted })}
                </Badge>
                <Badge
                  variant="light"
                  color={failed > 0 ? 'var(--mantine-color-red-6)' : 'var(--mantine-color-gray-6)'}
                  size="lg"
                >
                  {formatStringJson(t('failedCount'), { count: failed })}
                </Badge>
              </Group>
              {/* Panels are not kept mounted: a hidden one stops the virtualized list measuring, so it came back empty. */}
              {(hasFailures || hasDeletedRows) && (
                <Accordion
                  multiple
                  keepMounted={false}
                  defaultValue={[hasFailures ? 'failed' : 'deleted']}
                  variant="separated"
                >
                  {hasFailures && (
                    <Accordion.Item value="failed">
                      <Accordion.Control>{formatStringJson(t('failedSection'), { count: failed })}</Accordion.Control>
                      <Accordion.Panel>
                        {failed > failures.length && (
                          <Text size="sm" c="dimmed" mb="4px">
                            {formatStringJson(t('truncated'), { shown: failures.length, total: failed })}
                          </Text>
                        )}
                        <DeleteKeyList rows={failureRows} />
                      </Accordion.Panel>
                    </Accordion.Item>
                  )}
                  {hasDeletedRows && (
                    <Accordion.Item value="deleted">
                      <Accordion.Control>{formatStringJson(t('deletedSection'), { count: deleted })}</Accordion.Control>
                      <Accordion.Panel>
                        <DeleteKeyList rows={deletedRows} />
                      </Accordion.Panel>
                    </Accordion.Item>
                  )}
                </Accordion>
              )}
            </Stack>
          </Paper>
        </Modal.Body>

        <Divider />

        <Group p="8px" justify="flex-end" wrap="nowrap">
          <Button onClick={onClickOk}>{t('common:button.OK')}</Button>
        </Group>
      </Modal.Content>
    </Modal.Root>
  );
});
