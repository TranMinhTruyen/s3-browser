import { Card, Text } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { File, Folder } from 'lucide-react';
import { CSSProperties, memo, useCallback, useState } from 'react';
import { useRemeasureOnScale, useUiScale } from '@/common/hooks/useUiScale';
import TruncatedText from '@/components/display/TruncatedText';

const LIST_MAX_HEIGHT = '20rem';
// Số px ở cỡ trung bình (co giãn theo cỡ giao diện): chiều cao thẻ một dòng cộng khoảng cách; chiều cao thật được đo
// vì lý do lỗi có thể xuống dòng.
const ROW_ESTIMATE_HEIGHT = 56;
const ROW_GAP = '0.5rem';
// Dùng cùng đường viền với các thẻ trong danh sách đối tượng.
const CARD_BORDER_COLOR = 'light-dark(var(--mantine-color-black), var(--mantine-color-dark-2))';

export type DeleteKeyRow = {
  key: string;
  // Lý do key không xử lý được.
  error?: string;
};

type DeleteKeyListProps = {
  rows: DeleteKeyRow[];
  maxHeight?: number | string;
};

// Lý do lỗi có thể xuống dòng ở mọi vị trí (key không có dấu cách); không để nội dung làm rộng danh sách (không cuộn ngang).
const wrapStyle: CSSProperties = { overflowWrap: 'anywhere', wordBreak: 'break-word' };
const ICON_SECTION_STYLE: CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderColor: CARD_BORDER_COLOR,
};
const NAME_SECTION_STYLE: CSSProperties = { flex: 1, minWidth: 0 };

/** Đoạn cuối đường dẫn của key; key thư mục kết thúc bằng "/" nên bỏ dấu đó khỏi tên. */
const getKeyName = (key: string) => key.replace(/\/$/, '').split('/').pop() || key;

/** Danh sách thẻ ảo có thể cuộn dọc, mỗi key một thẻ kèm lý do lỗi. Văn bản tự xuống dòng, không cuộn ngang. */
const DeleteKeyList = memo(function DeleteKeyList(props: DeleteKeyListProps) {
  const { rows, maxHeight = LIST_MAX_HEIGHT } = props;

  // Dùng state thay vì ref vì bên trong portal của Modal, phần tử mount chậm một lần render.
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);

  const getScrollElement = useCallback(() => scrollElement, [scrollElement]);
  const scale = useUiScale();
  const estimateSize = useCallback(() => ROW_ESTIMATE_HEIGHT * scale, [scale]);

  // React Compiler đang tắt nên quy tắc lint chỉ dành cho compiler này không áp dụng.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement,
    estimateSize,
    overscan: 10,
  });
  useRemeasureOnScale(virtualizer, scale);

  return (
    <div
      ref={setScrollElement}
      style={{ maxHeight, overflowX: 'hidden', overflowY: 'auto', scrollbarGutter: 'stable' }}
    >
      <div style={{ position: 'relative', width: '100%', height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(item => {
          const row = rows[item.index];
          const isFolder = row.key.endsWith('/');
          const name = getKeyName(row.key);
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`,
                paddingBottom: ROW_GAP,
              }}
            >
              <Card padding="0.5rem" orientation="horizontal" style={{ border: `1px solid ${CARD_BORDER_COLOR}` }}>
                <Card.Section inheritPadding px="0.5rem" withBorder style={ICON_SECTION_STYLE}>
                  {isFolder ? <Folder size="1.25rem" /> : <File size="1.25rem" />}
                </Card.Section>
                <Card.Section inheritPadding px="md" py="xs" style={NAME_SECTION_STYLE}>
                  {/* The full key is the hint when the name alone does not tell it. */}
                  <TruncatedText fw={500} label={row.key} alwaysTip={name !== row.key}>
                    {name}
                  </TruncatedText>
                  {row.error !== undefined && (
                    <Text
                      size="sm"
                      c="light-dark(var(--mantine-color-red-7), var(--mantine-color-red-4))"
                      style={wrapStyle}
                    >
                      {row.error}
                    </Text>
                  )}
                </Card.Section>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
});
export default DeleteKeyList;
