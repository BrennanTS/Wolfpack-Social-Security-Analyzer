/**
 * App release version — single source of truth is package.json.
 * Bump `version` in package.json before each deploy; the header badge and PDF
 * footer read from here automatically.
 */
import packageJson from '../../package.json';

export const APP_VERSION = packageJson.version;

export function formatVersionLabel(prefix = 'v'): string {
  return `${prefix}${APP_VERSION}`;
}
