/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard'],
  rules: {
    // CSS module classes are read in TSX as styles.camelCase; kebab-case is for classes set outside React.
    'selector-class-pattern': [
      '^([a-z][a-zA-Z0-9]*|[a-z][a-z0-9]*(-[a-z0-9]+)*)$',
      { message: name => `Expected class selector "${name}" to be camelCase or kebab-case` },
    ],
    // :global(...) is the CSS modules escape for class names set outside React (e.g. by the Wails runtime).
    'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['global'] }],
  },
};
