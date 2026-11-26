import { Combobox, ScrollArea } from '@mantine/core';
import { ReactNode } from 'react';

type ComboboxOptionsProps = {
  children: ReactNode;
  // Chiều cao trước khi danh sách bắt đầu cuộn.
  maxHeight?: number;
};

/** `Combobox.Options` dùng thanh cuộn mảnh như Mantine `Select` thay cho thanh cuộn mặc định của hệ thống. */
function ComboboxOptions({ children, maxHeight = 250 }: ComboboxOptionsProps) {
  return (
    <Combobox.Options>
      <ScrollArea.Autosize mah={maxHeight} type="scroll" scrollbarSize="var(--combobox-padding)" offsetScrollbars="y">
        {children}
      </ScrollArea.Autosize>
    </Combobox.Options>
  );
}
export default ComboboxOptions;
