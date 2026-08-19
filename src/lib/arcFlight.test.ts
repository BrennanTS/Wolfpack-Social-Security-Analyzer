import { describe, expect, it } from 'vitest';
import { arcKeyframes } from './arcFlight';

const at = (frame: Keyframe) => {
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(String(frame.transform));
  return { x: Number(match![1]), y: Number(match![2]) };
};

describe('arcKeyframes', () => {
  const from = { x: 100, y: 400 };
  const to = { x: 500, y: 100 };
  const frames = arcKeyframes(from, to, 0.32);

  it('leaves and lands exactly on its two points', () => {
    // `4t(1-t)` is zero at both ends, so the lift cannot displace the token
    // from either target however far apart they are — which is what lets the
    // arc be computed from live rects instead of a fixed path.
    expect(at(frames[0])).toEqual(from);
    expect(at(frames[frames.length - 1])).toEqual(to);
  });

  it('rises above the straight line in between', () => {
    const middle = at(frames[Math.floor(frames.length / 2)]);
    const straightY = (from.y + to.y) / 2;
    // Screen coordinates: smaller y is higher up.
    expect(middle.y).toBeLessThan(straightY);
  });

  it('peaks in the middle and nowhere else', () => {
    const lifts = frames.map((f, i) => {
      const t = i / (frames.length - 1);
      return from.y + (to.y - from.y) * t - at(f).y;
    });
    const peak = lifts.indexOf(Math.max(...lifts));
    expect(peak).toBeGreaterThan(frames.length * 0.4);
    expect(peak).toBeLessThan(frames.length * 0.6);
  });

  it('scales the arc to the distance, so a short hop is not launched into orbit', () => {
    const near = arcKeyframes({ x: 0, y: 0 }, { x: 20, y: 0 }, 0.32);
    const far = arcKeyframes({ x: 0, y: 0 }, { x: 800, y: 0 }, 0.32);
    const riseOf = (fs: Keyframe[]) => -at(fs[Math.floor(fs.length / 2)]).y;
    expect(riseOf(near)).toBeLessThan(riseOf(far));
    expect(riseOf(near)).toBeLessThan(20);
  });

  it('fades only at the very end, so the token is visible for the whole flight', () => {
    expect(Number(frames[0].opacity)).toBe(1);
    expect(Number(frames[Math.floor(frames.length / 2)].opacity)).toBe(1);
    expect(Number(frames[frames.length - 1].opacity)).toBeLessThan(0.1);
  });

  it('carries an offset on every frame, in order', () => {
    // Without offsets the browser distributes frames evenly, which for a
    // parabola sampled at even t IS even — but the two would drift apart the
    // moment the sampling changed.
    const offsets = frames.map((f) => f.offset as number);
    expect(offsets[0]).toBe(0);
    expect(offsets[offsets.length - 1]).toBe(1);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });

  it('clamps the rise so a long flight stays on screen', () => {
    // Across a tall page the natural arc peaks above the top of the window,
    // and a token that leaves the viewport reads as having vanished rather
    // than as having leapt.
    const tall = arcKeyframes({ x: 0, y: 780 }, { x: 900, y: 80 }, 0.32, 24, 60);
    const peak = Math.min(...tall.map((f) => at(f).y));
    expect(peak).toBeGreaterThanOrEqual(80 - 60);
  });

  it('degrades to a straight line rather than inverting when there is no headroom', () => {
    const flat = arcKeyframes({ x: 0, y: 40 }, { x: 400, y: 20 }, 0.32, 24, -100);
    const mid = at(flat[12]);
    expect(mid.y).toBeCloseTo(30, 0);
  });
});
