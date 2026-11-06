import { describe, expect, it } from 'vitest';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const LANGS = ['vi', 'ja', 'zh-CN', 'zh-TW', 'ru', 'de'] as const;

const modules = import.meta.glob<Json>('/src/locales/*/**/*.json', { eager: true, import: 'default' });

const byLang = new Map<string, Map<string, Json>>();
for (const [path, content] of Object.entries(modules)) {
  const [, lang, ...rest] = path.replace('/src/locales/', '/').split('/');
  if (!byLang.has(lang)) byLang.set(lang, new Map());
  byLang.get(lang)?.set(rest.join('/'), content);
}

const flatten = (value: Json, prefix = '', out: Record<string, string> = {}): Record<string, string> => {
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out[prefix] = String(value);
  }
  return out;
};

const placeholders = (text: string): string[] =>
  (text.match(/\{\{\s*[^{}]+?\s*\}\}|\{[^{}]+\}/g) ?? []).map(p => p.replace(/\s+/g, '')).sort();

const en = byLang.get('en') as Map<string, Json>;

describe('locale parity', () => {
  it('has en files and all 7 languages', () => {
    expect(en.size).toBeGreaterThan(0);
    expect([...byLang.keys()].sort()).toEqual(['en', ...LANGS].sort());
  });

  describe.each(LANGS)('%s', lang => {
    const files = byLang.get(lang) as Map<string, Json>;

    it('has the same set of files as en', () => {
      expect([...files.keys()].sort()).toEqual([...en.keys()].sort());
    });

    it.each([...en.keys()])('%s has the same keys and placeholders as en', file => {
      const base = flatten(en.get(file) as Json);
      const target = flatten((files.get(file) ?? {}) as Json);

      expect(Object.keys(target).sort()).toEqual(Object.keys(base).sort());
      const mismatched = Object.keys(base)
        .filter(key => key in target)
        .filter(key => placeholders(target[key]).join('|') !== placeholders(base[key]).join('|'));
      expect(mismatched).toEqual([]);
    });
  });
});
