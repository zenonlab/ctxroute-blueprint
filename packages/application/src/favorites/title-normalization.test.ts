import { describe, expect, it } from 'vitest';
import { favoriteProviderDiscoveryTitles, hasFavoriteOvaMarker, hasFavoritePreSerializationMarker, isWithinFavoriteEditDistance, normalizeFavoriteTitle, readSafeParenthesizedFavoriteTitle } from './title-normalization';

describe('favorite title normalization', () => {
  it('normalizes Unicode, punctuation and spacing without mutating the source', () => {
    const raw = "  L’Épopée:  de Frieren!  ";
    expect(normalizeFavoriteTitle(raw)).toEqual({ compact: 'lepopeedefrieren', normalized: 'l epopee de frieren', significantTokens: ['l', 'epopee', 'frieren'] });
    expect(raw).toBe("  L’Épopée:  de Frieren!  ");
  });

  it('removes only the closed insignificant-token vocabulary', () => {
    expect(normalizeFavoriteTitle('The Season of Dub Academy').significantTokens).toEqual(['academy']);
    expect(normalizeFavoriteTitle('Submarine Scanner').significantTokens).toEqual(['submarine', 'scanner']);
  });

  it('applies the documented edit bound without a full distance matrix', () => {
    expect(isWithinFavoriteEditDistance('sousounofrieren', 'sousounofriren')).toBe(true);
    expect(isWithinFavoriteEditDistance('short', 'shot')).toBe(false);
    expect(isWithinFavoriteEditDistance('abcdefgh', 'abcdefxh')).toBe(true);
    expect(isWithinFavoriteEditDistance('abcdefgh', 'abcdwxyz')).toBe(false);
    expect(isWithinFavoriteEditDistance(`${'a'.repeat(8 * 1024 - 1)}b`, `${'a'.repeat(8 * 1024 - 1)}c`)).toBe(true);
  });
});

describe('structured favorite title preparation', () => {
  it('extracts a safe final parenthesized alternate and keeps discovery bounded', () => {
    expect(readSafeParenthesizedFavoriteTitle('Existence (Wangho)')).toEqual({ alternate: 'Wangho', base: 'Existence' });
    expect(favoriteProviderDiscoveryTitles(['Existence (Wangho)'])).toEqual(['Existence (Wangho)', 'Existence', 'Wangho', 'existencewangho']);
  });

  it.each(['Existence (2024)', 'Existence (2)', 'Existence (OVA)', 'Existence (Novel)', 'Existence (English)', 'Existence ((Wangho))'])('rejects qualifier or nested alternate %s', (title) => {
    expect(readSafeParenthesizedFavoriteTitle(title)).toBeUndefined();
  });

  it('recognizes compatibility markers without partial words', () => {
    expect(hasFavoriteOvaMarker(['Synthetic OVA'])).toBe(true);
    expect(hasFavoriteOvaMarker(['Ovation'])).toBe(false);
    expect(hasFavoritePreSerializationMarker(['Synthetic Light Novel'])).toBe(true);
    expect(hasFavoritePreSerializationMarker(['Novelty'])).toBe(false);
  });
});
