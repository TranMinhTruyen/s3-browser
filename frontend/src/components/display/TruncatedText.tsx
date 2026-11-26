import { Text, TextProps, Tooltip } from '@mantine/core';
import { MouseEvent, memo, useCallback, useState } from 'react';

type TruncatedTextProps = TextProps & {
  children?: string;
  /** Nội dung tooltip; mặc định là chính văn bản đó. */
  label?: string;
  /** Vẫn hiện tooltip kể cả khi văn bản chưa bị cắt. */
  alwaysTip?: boolean;
};

/** Văn bản một dòng được cắt bằng dấu ba chấm. Chỉ đo phần bị cắt khi rê chuột nên danh sách dài không tốn thêm mỗi lần render. */
const TruncatedText = memo(function TruncatedText(props: TruncatedTextProps) {
  const { children, label = children, alwaysTip = false, ...rest } = props;
  const [opened, setOpened] = useState(false);

  const onMouseEnterText = useCallback(
    (e: MouseEvent<HTMLElement>) => setOpened(alwaysTip || e.currentTarget.scrollWidth > e.currentTarget.clientWidth),
    [alwaysTip]
  );
  const onMouseLeaveText = useCallback(() => setOpened(false), []);

  return (
    <Tooltip label={label} opened={opened} withinPortal>
      <Text {...rest} truncate="end" onMouseEnter={onMouseEnterText} onMouseLeave={onMouseLeaveText}>
        {children}
      </Text>
    </Tooltip>
  );
});
export default TruncatedText;
