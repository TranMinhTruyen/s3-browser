import { createTheme } from '@mantine/core';
import classes from '@/components/inputs/combobox/combobox.module.css';

const dropdownClassNames = { dropdown: classes.dropdown, search: classes.search, option: classes.option };

/**
 * App-wide Mantine theme. Every combobox-based dropdown shares one look. Select, MultiSelect,
 * Autocomplete and TagsInput render their own Combobox, so each needs its own entry.
 */
export const appTheme = createTheme({
  components: {
    Combobox: { classNames: dropdownClassNames },
    Select: { classNames: dropdownClassNames },
    MultiSelect: { classNames: dropdownClassNames },
    Autocomplete: { classNames: dropdownClassNames },
    TagsInput: { classNames: dropdownClassNames },
  },
});
