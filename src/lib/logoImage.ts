/**
 * Turning a chosen image file into something a theme can carry.
 *
 * Scaled down before it is stored, not after: an adviser picks the logo they
 * have, which is routinely a 2000px PNG, and a browser's whole storage budget
 * is a few megabytes shared with the saved layouts and the client list. The
 * cover prints it at 34pt tall, so anything past a few hundred pixels is
 * detail nobody will ever see.
 */

/** The longest edge, in pixels, that a stored logo keeps. */
export const MAX_LOGO_EDGE = 600;

/**
 * How big a stored logo may be before it is re-encoded even at full size.
 *
 * A browser's whole storage budget is a few megabytes, shared with the saved
 * layouts and the client list, and the theme travels in exports.
 */
export const MAX_LOGO_BYTES = 120_000;

export interface LogoTarget {
  /**
   * True when the file as chosen is already small enough in both dimensions
   * and bytes. Kept verbatim rather than re-encoded, because a round trip
   * through a canvas is a lossy no-op at best.
   */
  keepOriginal: boolean;
  width: number;
  height: number;
}

/**
 * What a chosen image should be stored as.
 *
 * Split out from `readLogoFile` because it is the only part with a decision
 * in it — the rest is `FileReader`, `Image` and `<canvas>`, none of which
 * jsdom provides. Leaving the arithmetic inside the browser plumbing meant
 * the whole module sat at 3% coverage while the one thing that could be
 * wrong went unexercised.
 *
 * Never returns a zero dimension: a 2000x1 banner scales its height to 0.3px,
 * and a canvas of height 0 draws nothing at all — a logo that silently
 * vanishes from the cover rather than looking wrong.
 */
export function logoTarget(width: number, height: number, byteLength: number): LogoTarget {
  const longest = Math.max(width, height);
  const scale = longest > 0 ? Math.min(1, MAX_LOGO_EDGE / longest) : 1;
  return {
    keepOriginal: scale >= 1 && byteLength <= MAX_LOGO_BYTES,
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Read an image file as a data URL, scaled to fit `MAX_LOGO_EDGE`.
 *
 * Returns null for anything that will not decode — which includes a file
 * renamed to `.png`, and an SVG, which a canvas will not taint-free rasterize
 * from a data URL in every browser.
 */
export async function readLogoFile(file: File): Promise<string | null> {
  const dataUrl = await readAsDataUrl(file);
  if (dataUrl === null) return null;
  try {
    const image = await decode(dataUrl);
    const target = logoTarget(image.width, image.height, dataUrl.length);
    if (target.keepOriginal) return dataUrl;

    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d');
    if (context === null) return dataUrl;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // PNG, not JPEG: a logo is usually flat color on transparency, and JPEG
    // would put a white box and a ring of artifacts around it on the cover.
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

function readAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function decode(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('undecodable'));
    image.src = dataUrl;
  });
}
