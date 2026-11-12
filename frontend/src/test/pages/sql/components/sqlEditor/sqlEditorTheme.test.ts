import { describe, expect, it, vi } from 'vitest';
import { sqlEditorTheme } from '@/pages/sql/components/sqlEditor/sqlEditorTheme';

type Rule = Record<string, string>;
type Spec = Record<string, Rule>;
type HighlightSpec = { tag: unknown; color?: string; fontWeight?: string; fontStyle?: string };

// Capture the raw specs: CodeMirror compiles them into opaque style modules.
const captured = vi.hoisted(() => ({ theme: undefined as unknown, highlight: undefined as unknown }));

vi.mock('@codemirror/view', async importOriginal => {
  const mod = await importOriginal<typeof import('@codemirror/view')>();
  const original = mod.EditorView.theme.bind(mod.EditorView);
  vi.spyOn(mod.EditorView, 'theme').mockImplementation((spec, options) => {
    captured.theme = spec;
    return original(spec, options);
  });
  return mod;
});

vi.mock('@codemirror/language', async importOriginal => {
  const mod = await importOriginal<typeof import('@codemirror/language')>();
  const original = mod.HighlightStyle.define.bind(mod.HighlightStyle);
  vi.spyOn(mod.HighlightStyle, 'define').mockImplementation((specs, options) => {
    captured.highlight = specs;
    return original(specs, options);
  });
  return mod;
});

const themeSpec = (): Spec => captured.theme as Spec;
const highlightSpecs = (): HighlightSpec[] => captured.highlight as HighlightSpec[];

const allValues = (spec: Spec) => Object.values(spec).flatMap(rule => Object.values(rule));

describe('sqlEditorTheme', () => {
  it('is a non-empty list of extensions', () => {
    expect(themeSpec()).toBeDefined();
    expect(Array.isArray(sqlEditorTheme)).toBe(true);
    expect(sqlEditorTheme).toHaveLength(2);
  });

  it('has no hard-coded hex/rgb/hsl colors in the theme', () => {
    for (const value of allValues(themeSpec())) {
      expect(value).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(value).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/i);
    }
  });

  it('draws the active line translucent so the selection stays visible under it', () => {
    const bg = themeSpec()['.cm-activeLine'].backgroundColor;
    expect(bg).toContain('light-dark(');
    expect(bg).toContain('color-mix(');
    expect(bg).toContain('transparent');
  });

  it('uses only theme variables for every color property in the theme', () => {
    const colorProps = ['color', 'backgroundColor', 'borderColor', 'borderLeftColor'];
    for (const rule of Object.values(themeSpec())) {
      for (const prop of colorProps) {
        // `inherit` is a CSS keyword (the completion label takes the selected row's color), not a hard-coded color.
        if (rule[prop]) expect(rule[prop]).toMatch(/^(var\(|light-dark\(|inherit$)/);
      }
    }
  });

  it('uses Mantine font family and font size for scroller, content and gutters', () => {
    const spec = themeSpec();
    for (const selector of ['.cm-scroller', '.cm-content', '.cm-gutters']) {
      expect(spec[selector].fontFamily).toBe('var(--mantine-font-family)');
      expect(spec[selector].fontSize).toBe('var(--mantine-font-size-sm)');
    }
  });

  it('never uses a monospace font (D15)', () => {
    for (const value of allValues(themeSpec())) {
      expect(value).not.toMatch(/monospace/i);
    }
  });

  it('highlight style covers keyword, string, number, comment and operator tags', async () => {
    const { tags } = await import('@lezer/highlight');
    const specs = highlightSpecs();
    const covered = specs.flatMap(s => (Array.isArray(s.tag) ? s.tag : [s.tag]));
    for (const tag of [tags.keyword, tags.string, tags.number, tags.comment, tags.operator]) {
      expect(covered).toContain(tag);
    }
  });

  it('highlight colors only come from theme variables', () => {
    const specs = highlightSpecs();
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) {
      expect(s.color).toMatch(/^light-dark\(var\(--mantine-color-[\w-]+\), var\(--mantine-color-[\w-]+\)\)$/);
      expect(s.color).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|hsl/i);
    }
  });

  it('styles keywords bold and comments italic', async () => {
    const { tags } = await import('@lezer/highlight');
    const specs = highlightSpecs();
    const has = (t: unknown) => (s: { tag: unknown }) => (Array.isArray(s.tag) ? s.tag : [s.tag]).includes(t);
    expect(specs.find(has(tags.keyword))?.fontWeight).toBe('600');
    expect(specs.find(has(tags.comment))?.fontStyle).toBe('italic');
  });
});
