// Security decisions of the desktop app, kept apart from Electron so they can be tested.
const path = require('path');

const APP_HOST = 'market';

/** What the page may load and talk to: its own files, product names from Open Food Facts. */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: mediastream:",
  "connect-src 'self' https://world.openfoodfacts.org",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** A link the app hands to the system browser: https only, never a file or a script. */
function isExternalUrl(url) {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The file in `distDir` an `app://market/...` request names, or null for anything that is not
 * ours or would leave `distDir`. The bare address is the app's page.
 */
function resolveAppFile(distDir, requestUrl) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'app:' || url.host !== APP_HOST) {
    return null;
  }
  let relative;
  try {
    relative = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  // A backslash or NUL decoded from the address could step out on Windows or cut the name.
  if (relative.includes('\\') || relative.includes('\u0000')) {
    return null;
  }
  if (relative === '' || relative.endsWith('/')) {
    relative += 'index.html';
  }
  const root = path.resolve(distDir);
  const file = path.resolve(root, '.' + relative);
  return file.startsWith(root + path.sep) ? file : null;
}

/** Developer tools let anyone at the till rewrite the session or the data, so a packaged app has none. */
function devToolsAllowed(isPackaged) {
  return !isPackaged;
}

module.exports = {
  APP_HOST,
  CONTENT_SECURITY_POLICY,
  isExternalUrl,
  resolveAppFile,
  devToolsAllowed,
};
