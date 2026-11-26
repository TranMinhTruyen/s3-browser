/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard'],
  rules: {
    // Class của CSS module được truy cập trong TSX dưới dạng styles.camelCase; kebab-case dành cho class đặt ngoài React.
    'selector-class-pattern': [
      '^([a-z][a-zA-Z0-9]*|[a-z][a-z0-9]*(-[a-z0-9]+)*)$',
      { message: name => `Expected class selector "${name}" to be camelCase or kebab-case` },
    ],
    // :global(...) là cú pháp CSS modules để giữ nguyên class đặt ngoài React (ví dụ do runtime Wails gắn vào).
    'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['global'] }],
  },
};
