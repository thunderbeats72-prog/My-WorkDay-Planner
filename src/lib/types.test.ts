import { describe, expect, it } from 'vitest';
import {
  categoryChoices,
  categoryLabel,
  categoryMeta,
  CATEGORY_ORDER,
  normaliseCustomCategory,
  prettyCategoryName,
  type Settings,
} from './types';
import { DEFAULT_SETTINGS } from './types';

/**
 * A category the user names themselves.
 *
 * The eight built-ins are a starting point; a sales day also has “Licensing”
 * and “Recruitment”. The risk with a custom category is not creating it — it is
 * that every screen that assumed a fixed list (`CATEGORIES[category].label`)
 * turns into `undefined` the moment the value is a word the app has not seen.
 */

const withCustom = (customCategories: string[]): Settings => ({ ...DEFAULT_SETTINGS, customCategories });

describe('naming a category', () => {
  it('tidies the name the user typed', () => {
    expect(prettyCategoryName('  licensing  ')).toBe('Licensing');
    expect(prettyCategoryName('field   work')).toBe('Field Work');
    // Capitalisation the user chose is kept, not flattened.
    expect(prettyCategoryName('R&D')).toBe('R&D');
  });

  it('accepts a new name and refuses a duplicate or an empty one', () => {
    expect(normaliseCustomCategory('Licensing', [])).toEqual({ ok: true, value: 'Licensing' });
    // Same word, different case — one category, not two chips that look alike.
    expect(normaliseCustomCategory('licensing', ['Licensing']).ok).toBe(false);
    // A built-in is already a category.
    expect(normaliseCustomCategory('Follow-up', []).ok).toBe(false);
    expect(normaliseCustomCategory('   ', []).ok).toBe(false);
    expect(normaliseCustomCategory('---', []).ok).toBe(false);
  });

  it('keeps the list to a readable length', () => {
    expect(normaliseCustomCategory('x'.repeat(30), []).ok).toBe(false);
  });

  it('lets a renamed category keep its place without clashing with itself', () => {
    const existing = ['Licensing', 'Recruitment'];
    // Renaming “Licensing” to a different case of its own name is not a clash.
    expect(normaliseCustomCategory('LICENSING', existing, 'Licensing')).toEqual({
      ok: true,
      value: 'LICENSING',
    });
    // Renaming it onto another real category still is.
    expect(normaliseCustomCategory('Recruitment', existing, 'Licensing').ok).toBe(false);
    // …and the limit counts the category once, not twice.
    const full = Array.from({ length: 20 }, (_, index) => `Cat ${index}`);
    expect(normaliseCustomCategory('Cat 0 renamed', full, 'Cat 0').ok).toBe(true);
  });
});

describe('showing a category', () => {
  it('renders a custom one with a readable label and a stable tone', () => {
    expect(categoryLabel('Licensing')).toBe('Licensing');
    expect(categoryMeta('Licensing').tone).toBe(categoryMeta('Licensing').tone);
    expect(categoryMeta('Licensing').label).toBe('Licensing');
  });

  it('still renders every built-in exactly as before', () => {
    expect(CATEGORY_ORDER).toHaveLength(8);
    expect(categoryLabel('follow_up')).toBe('Follow-up');
    expect(categoryLabel('other')).toBe('Other');
  });

  it('offers the built-ins, then the user’s own, in the picker', () => {
    const choices = categoryChoices(withCustom(['Licensing', 'Recruitment']));
    expect(choices.slice(0, 8)).toEqual(CATEGORY_ORDER);
    expect(choices.slice(8)).toEqual(['Licensing', 'Recruitment']);
  });

  it('survives settings saved before custom categories existed', () => {
    const legacy = { ...DEFAULT_SETTINGS } as Partial<Settings>;
    delete legacy.customCategories;
    expect(categoryChoices(legacy as Settings)).toEqual(CATEGORY_ORDER);
  });
});
