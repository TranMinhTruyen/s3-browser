import { Text, TextProps, Tooltip } from '@mantine/core';
import { MouseEvent, memo, useCallback, useState } from 'react';

type TruncatedTextProps = TextProps & {
  children: string;
  /** Tooltip content; defaults to the text itself. */
  label?: string;
  /** Show the tooltip even when the text is not cut. */
  alwaysTip?: boolean;
};

/** One-line text cut with an ellipsis. The cut is measured on hover only, so long lists pay nothing per render. */
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
