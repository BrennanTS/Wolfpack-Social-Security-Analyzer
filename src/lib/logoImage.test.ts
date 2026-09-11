import { describe, expect, it } from 'vitest';
import { logoTarget, MAX_LOGO_BYTES, MAX_LOGO_EDGE } from './logoImage';

/**
 * The logo is the one place an adviser hands the app a file, and the result
 * goes two places that punish size: `localStorage`, whose whole budget is a
 * few megabytes shared with saved clients and layouts, and the PDF cover.
 */
describe('what a chosen logo is stored as', () => {
  it('keeps a small file exactly as it was', () => {
    // A round trip through a canvas is lossy at best and pointless here, so
    // an image already within both limits is never re-encoded.
    expect(logoTarget(300, 120, 40_000)).toEqual({
      keepOriginal: true,
      width: 300,
      height: 120,
    });
  });

  it('caps the LONGEST edge, whichever one that is', () => {
    // 34pt tall on the cover, so past a few hundred pixels is detail nobody
    // will ever see — and a 2000px PNG is what an adviser actually has.
    const wide = logoTarget(2000, 500, 900_000);
    expect(Math.max(wide.width, wide.height)).toBe(MAX_LOGO_EDGE);
    expect(wide).toEqual({ keepOriginal: false, width: 600, height: 150 });

    const tall = logoTarget(500, 2000, 900_000);
    expect(Math.max(tall.width, tall.height)).toBe(MAX_LOGO_EDGE);
    expect(tall).toEqual({ keepOriginal: false, width: 150, height: 600 });
  });

  it('preserves the aspect ratio it was given', () => {
    const { width, height } = logoTarget(1600, 400, 900_000);
    expect(width / height).toBeCloseTo(4, 5);
  });

  it('re-encodes a small image that is nonetheless a huge file', () => {
    // The subtle branch: the dimensions are already fine, so scale is 1 and
    // nothing needs resizing — but the bytes are not, and storage is the
    // other limit. Both have to be under, not either.
    expect(logoTarget(200, 100, MAX_LOGO_BYTES + 1).keepOriginal).toBe(false);
    expect(logoTarget(200, 100, MAX_LOGO_BYTES).keepOriginal).toBe(true);
  });

  it('never produces a zero dimension', () => {
    // A 2000x1 banner scales its height to 0.3px, which rounds to 0 — and a
    // canvas of height 0 draws nothing, so the logo would vanish from the
    // cover rather than look wrong. Silent absence is the worse failure.
    const banner = logoTarget(2000, 1, 900_000);
    expect(banner.height).toBeGreaterThanOrEqual(1);
    expect(banner.width).toBe(600);

    const sliver = logoTarget(1, 2000, 900_000);
    expect(sliver.width).toBeGreaterThanOrEqual(1);
  });

  it('survives a degenerate image rather than dividing by zero', () => {
    // An image that reports 0x0 would make the scale Infinity and both
    // dimensions NaN, which a canvas accepts and then draws nothing from.
    const empty = logoTarget(0, 0, 10);
    expect(Number.isFinite(empty.width)).toBe(true);
    expect(empty.width).toBeGreaterThanOrEqual(1);
    expect(empty.height).toBeGreaterThanOrEqual(1);
  });
});
