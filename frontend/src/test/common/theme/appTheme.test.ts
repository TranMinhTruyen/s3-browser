import { describe, expect, it } from 'vitest';
import { appTheme } from '@/common/theme/appTheme';
import badgeClasses from '@/components/display/badge.module.css';
import classes from '@/components/inputs/combobox/combobox.module.css';

describe('appTheme', () => {
  it('defines non-empty dropdown, search and option classes in the css module', () => {
    expect(classes.dropdown).toBeTruthy();
    expect(classes.search).toBeTruthy();
    expect(classes.option).toBeTruthy();
  });

  it('Badge uses the trimmed label class', () => {
    expect(badgeClasses.label).toBeTruthy();
    const badge = appTheme.components?.Badge as { classNames: Record<string, string> };
    expect(badge.classNames).toEqual({ label: badgeClasses.label });
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
