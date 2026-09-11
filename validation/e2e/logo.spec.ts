import { expect, test } from './helpers/app';
import { solidPng } from './helpers/png';

/**
 * The logo upload, driven in a real browser because nothing else can drive it.
 *
 * `readLogoFile` is `FileReader` -> `new Image()` -> `<canvas>`, none of which
 * jsdom provides — the module sat at 3% coverage while being the one place an
 * adviser hands the app a file, and the result goes into `localStorage` and
 * onto the PDF cover. The scale arithmetic is unit-tested (`logoTarget`);
 * this covers the part that only exists in a browser: does a real PNG decode,
 * does an oversized one come back smaller, and is a file that is not an image
 * refused rather than stored.
 */

async function openThemeEditor(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Edit theme…' }).click();
}

/** The hidden input the "Choose image…" button clicks. */
const logoInput = 'input[type="file"][accept*="image"]';

test.describe('the report logo', () => {
  test('accepts a real image and stores it scaled down', async ({ page }) => {
    await page.goto('/');
    await openThemeEditor(page);

    // 1600px on its longest edge — four times the 600px cap, so this MUST
    // come back re-encoded rather than stored as handed over.
    const original = solidPng(1600, 400, [118, 147, 111]);
    await page.locator(logoInput).setInputFiles({
      name: 'firm-logo.png',
      mimeType: 'image/png',
      buffer: original,
    });

    await expect(page.getByText('Logo added.')).toBeVisible();

    const preview = page.locator('img.theme-logo-preview');
    await expect(preview).toBeVisible();

    const stored = await preview.getAttribute('src');
    expect(stored, 'the logo is stored as a data URL, never a file path').toMatch(
      /^data:image\/png;base64,/,
    );

    // Decoded back: the longest edge is capped, and the aspect ratio held.
    const size = await page.evaluate(
      (src) =>
        new Promise<{ w: number; h: number }>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => reject(new Error('stored logo did not decode'));
          img.src = src;
        }),
      stored!,
    );
    expect(size.w).toBe(600);
    expect(size.h).toBe(150);
  });

  test('keeps a small image rather than re-encoding it', async ({ page }) => {
    await page.goto('/');
    await openThemeEditor(page);

    const small = solidPng(200, 80, [168, 134, 63]);
    await page.locator(logoInput).setInputFiles({
      name: 'small.png',
      mimeType: 'image/png',
      buffer: small,
    });
    await expect(page.getByText('Logo added.')).toBeVisible();

    const stored = await page.locator('img.theme-logo-preview').getAttribute('src');
    // Byte-identical to the file chosen: a round trip through a canvas is
    // lossy at best, and pointless for something already within both limits.
    expect(stored).toBe(`data:image/png;base64,${small.toString('base64')}`);
  });

  test('refuses a file that is not an image, and says so', async ({ page }) => {
    await page.goto('/');
    await openThemeEditor(page);

    // A text file renamed `.png` — the shape of the mistake an adviser
    // actually makes. The browser's own accept filter does not catch it,
    // because the extension and the declared type both look right.
    await page.locator(logoInput).setInputFiles({
      name: 'not-really.png',
      mimeType: 'image/png',
      buffer: Buffer.from('this is not a PNG', 'utf8'),
    });

    await expect(page.getByText(/could not be read/i)).toBeVisible();
    // And nothing was stored: a rejected file must not leave a broken image
    // on the cover of every report from here on.
    await expect(page.locator('img.theme-logo-preview')).toHaveCount(0);
  });

  test('lets a chosen logo be removed again', async ({ page }) => {
    await page.goto('/');
    await openThemeEditor(page);

    await page.locator(logoInput).setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: solidPng(300, 120, [110, 139, 163]),
    });
    await expect(page.locator('img.theme-logo-preview')).toBeVisible();

    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator('img.theme-logo-preview')).toHaveCount(0);
  });
});
