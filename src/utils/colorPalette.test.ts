import { describe, expect, it } from 'vitest';
import { FLAG_PALETTE, pickFlagColor } from './colorPalette';

describe('pickFlagColor', () => {
  it('returns the first palette color when no existing colors are given', () => {
    expect(pickFlagColor([])).toBe(FLAG_PALETTE[0]);
  });

  it('returns the first palette color when all existing colors are undefined', () => {
    expect(pickFlagColor([undefined, undefined])).toBe(FLAG_PALETTE[0]);
  });

  it('skips already-used colors and picks the next available', () => {
    const result = pickFlagColor([FLAG_PALETTE[0], FLAG_PALETTE[1]]);
    expect(result).toBe(FLAG_PALETTE[2]);
  });

  it('returns the first color when all palette colors are taken', () => {
    const allColors = [...FLAG_PALETTE];
    const result = pickFlagColor(allColors);
    expect(result).toBe(FLAG_PALETTE[0]);
  });

  it('handles a mix of defined and undefined existing colors', () => {
    const result = pickFlagColor([FLAG_PALETTE[0], undefined, FLAG_PALETTE[2]]);
    expect(result).toBe(FLAG_PALETTE[1]);
  });

  it('returns the first unused color after skipping several used ones', () => {
    const result = pickFlagColor([FLAG_PALETTE[0], FLAG_PALETTE[1], FLAG_PALETTE[2], FLAG_PALETTE[3]]);
    expect(result).toBe(FLAG_PALETTE[4]);
  });
});
