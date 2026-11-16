import { describe, expect, it } from 'vitest';
import { appTheme } from '@/common/theme/appTheme';
import badgeClasses from '@/components/display/badge.module.css';
import classes from '@/components/inputs/combobox/combobox.module.css';

const badgeClassNames = (size?: string | number) => {
  const badge = appTheme.components?.Badge as { classNames: (theme: unknown, props: unknown) => unknown };
  return badge.classNames({}, { size });
};

describe('appTheme', () => {
  it('defines non-empty dropdown, search and option classes in the css module', () => {
    expect(classes.dropdown).toBeTruthy();
    expect(classes.search).toBeTruthy();
    expect(classes.option).toBeTruthy();
  });

  it.each([['xs'], ['sm'], ['md'], [undefined], [12]])('Badge size %s snaps the cap top to a whole pixel', size => {
    expect(badgeClasses.snap).toBeTruthy();
    expect(badgeClassNames(size)).toEqual({
      root: `${badgeClasses.root} ${badgeClasses.snap}`,
      label: badgeClasses.label,
    });
  });

  it.each([['lg'], ['xl']])('Badge size %s keeps the plain root class', size => {
    expect(badgeClassNames(size)).toEqual({ root: badgeClasses.root, label: badgeClasses.label });
  });

  it.each(['Combobox', 'Select', 'MultiSelect', 'Autocomplete', 'TagsInput'])(
    '%s uses the shared combobox classNames',
    name => {
      const component = appTheme.components?.[name] as { classNames: Record<string, string> };
      expect(component.classNames).toEqual({
        dropdown: classes.dropdown,
        search: classes.search,
        option: classes.option,
      });
    }
  );
});
