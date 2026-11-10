// The customer display: a second window of the app showing the register's cart, kept apart from
// Electron so where it opens can be tested.

const APP_HOST = 'market';

/** The app's own customer display page, and nothing else, may open as a window of ours. */
function isDisplayUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'app:' &&
    parsed.host === APP_HOST &&
    (parsed.pathname === '/' || parsed.pathname === '/index.html') &&
    parsed.hash === '#/display'
  );
}

/**
 * Where the display opens: full screen on the first monitor that is not the register's, or,
 * with one screen, as a window over its right half for the shop to move.
 */
function displayBounds(displays, primaryId) {
  const other = displays.find((screen) => screen.id !== primaryId);
  if (other) {
    return { bounds: other.bounds, fullscreen: true };
  }
  const main = displays.find((screen) => screen.id === primaryId) ?? displays[0];
  const half = Math.floor(main.bounds.width / 2);
  return {
    bounds: {
      x: main.bounds.x + main.bounds.width - half,
      y: main.bounds.y,
      width: half,
      height: main.bounds.height,
    },
    fullscreen: false,
  };
}

module.exports = { isDisplayUrl, displayBounds };
