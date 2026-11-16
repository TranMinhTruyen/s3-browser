import { Badge, createTheme } from '@mantine/core';
import badgeClasses from '@/components/display/badge.module.css';
import classes from '@/components/inputs/combobox/combobox.module.css';

const dropdownClassNames = { dropdown: classes.dropdown, search: classes.search, option: classes.option };

/**
 * App-wide Mantine theme. Every combobox-based dropdown shares one look. Select, MultiSelect,
 * Autocomplete and TagsInput render their own Combobox, so each needs its own entry. Badge labels
 * are trimmed to cap height so uppercase text is vertically centered at every UI size.
 */
export const appTheme = createTheme({
  components: {
    Badge: Badge.extend({
      classNames: (_theme, { size }) => ({
        root: size === 'lg' || size === 'xl' ? badgeClasses.root : `${badgeClasses.root} ${badgeClasses.snap}`,
        label: badgeClasses.label,
      }),
    }),
    Combobox: { classNames: dropdownClassNames },
    Select: { classNames: dropdownClassNames },
    MultiSelect: { classNames: dropdownClassNames },
    Autocomplete: { classNames: dropdownClassNames },
    TagsInput: { classNames: dropdownClassNames },
  },
});
