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
    const scale = Math.min(1, MAX_LOGO_EDGE / Math.max(image.width, image.height));
    if (scale >= 1 && dataUrl.length <= 120_000) return dataUrl;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
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
