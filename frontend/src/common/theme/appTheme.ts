import { Badge, createTheme } from '@mantine/core';
import badgeClasses from '@/components/display/badge.module.css';
import classes from '@/components/inputs/combobox/combobox.module.css';

const dropdownClassNames = { dropdown: classes.dropdown, search: classes.search, option: classes.option };

/**
 * Theme Mantine dùng cho toàn ứng dụng. Mọi danh sách thả xuống dựa trên combobox có giao diện đồng nhất. Select, MultiSelect,
 * Autocomplete và TagsInput tự render Combobox riêng nên mỗi component cần một cấu hình riêng. Nhãn Badge
 * được thu theo chiều cao chữ hoa để chữ in hoa luôn căn giữa dọc ở mọi cỡ giao diện.
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
