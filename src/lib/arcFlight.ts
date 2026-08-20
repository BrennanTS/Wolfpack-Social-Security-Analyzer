/**
 * A token that leaps from one element to another along an arc.
 *
 * Applying a square in the claiming grid changes the whole report, but the
 * evidence of it lands on a different tab — so the click looked like it did
 * nothing. This draws the connection: something leaves the button and lands
 * on the tab that now holds the result.
 *
 * Motion is the least reliable of the three signals the panel gives (the
 * button's own label and the tab's pulse are the others), so everything here
 * degrades to nothing rather than to something broken: no `animate`, no
 * layout, or a reader who has asked for reduced motion, and the caller's
 * other feedback still stands on its own.
 */
export interface ArcFlightOptions {
  /** How high the arc rises above the straight line, as a share of its length. */
  lift?: number;
  durationMs?: number;
  /** Size of the token in pixels. */
  size?: number;
  /** CSS color for the token. */
  color?: string;
}

/** How close to the top of the window the arc may come. */
const VIEWPORT_MARGIN = 12;

/** Whether this reader has asked not to be animated. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Points along the arc, as `translate`/`scale` keyframes.
 *
 * A parabola rather than a CSS `motion-path`: the path is computed from two
 * live rects that move with the layout, and a fixed path string cannot be.
 * `4t(1-t)` peaks at 1 halfway and is 0 at both ends, so the token leaves and
 * lands exactly on its targets however far apart they are.
 *
 * Exported for its test — the shape of the arc is the whole point, and it is
 * the one part of this that can be checked without a browser.
 */
export function arcKeyframes(
  from: { x: number; y: number },
  to: { x: number; y: number },
  lift: number,
  steps = 24,
  maxHeight = Infinity,
): Keyframe[] {
  const frames: Keyframe[] = [];
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  // Clamped, because a long flight across a tall page arcs high enough to
  // leave the viewport — and a token that goes off the top does not read as
  // a leap, it reads as having vanished.
  const height = Math.max(0, Math.min(distance * lift, maxHeight));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t - height * 4 * t * (1 - t);
    // Shrinks on the way down, so it reads as landing rather than stopping.
    const scale = 1 - 0.45 * t * t;
    frames.push({
      offset: t,
      transform: `translate(${x}px, ${y}px) scale(${scale})`,
      opacity: t > 0.85 ? String((1 - t) / 0.15) : '1',
    });
  }
  return frames;
}

/**
 * Sends a token from `origin` to `target`. Resolves when it lands, or
 * immediately when it cannot fly.
 */
export function flyBetween(
  origin: Element | null,
  target: Element | null,
  options: ArcFlightOptions = {},
): Promise<void> {
  const { lift = 0.32, durationMs = 620, size = 18, color = 'var(--gold)' } = options;

  if (origin === null || target === null || prefersReducedMotion()) return Promise.resolve();
  if (typeof document === 'undefined') return Promise.resolve();

  const a = origin.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  // A collapsed rect means the element is not laid out — display:none, or an
  // unmounted tab panel. Flying from nowhere to nowhere draws a token in the
  // corner of the screen.
  if (a.width === 0 || b.width === 0) return Promise.resolve();

  const token = document.createElement('div');
  token.className = 'arc-flight-token';
  token.setAttribute('aria-hidden', 'true');
  Object.assign(token.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '4px',
    background: color,
    pointerEvents: 'none',
    zIndex: '9999',
  });
  document.body.appendChild(token);

  const center = (r: DOMRect) => ({ x: r.left + r.width / 2 - size / 2, y: r.top + r.height / 2 - size / 2 });
  const start = center(a);
  const end = center(b);
  // The arc peaks at the midpoint's height less the lift, so this is how far
  // it may rise before the token clears the top of the window.
  const headroom = (start.y + end.y) / 2 - VIEWPORT_MARGIN;
  const frames = arcKeyframes(start, end, lift, 24, headroom);

  if (typeof token.animate !== 'function') {
    token.remove();
    return Promise.resolve();
  }

  const animation = token.animate(frames, {
    duration: durationMs,
    easing: 'cubic-bezier(0.33, 0, 0.2, 1)',
  });

  return new Promise<void>((resolve) => {
    const done = () => {
      token.remove();
      resolve();
    };
    animation.onfinish = done;
    animation.oncancel = done;
  });
}
