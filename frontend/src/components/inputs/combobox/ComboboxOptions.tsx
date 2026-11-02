import { Combobox, ScrollArea } from '@mantine/core';
import { ReactNode } from 'react';

type ComboboxOptionsProps = {
  children: ReactNode;
  // Height before the list starts scrolling.
  maxHeight?: number;
};

/** `Combobox.Options` with the same thin scrollbar as Mantine `Select` instead of the native one. */
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
