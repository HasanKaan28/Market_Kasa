import { describe, expect, it } from 'vitest';
import display from './display.cjs';

const { displayBounds, isDisplayUrl } = display;

const laptop = { id: 1, bounds: { x: 0, y: 0, width: 1366, height: 768 } };
const monitor = { id: 2, bounds: { x: 1366, y: 0, width: 1920, height: 1080 } };

describe('the customer display window', () => {
  it('opens only for the app’s own display page', () => {
    expect(isDisplayUrl('app://market/index.html#/display')).toBe(true);
    expect(isDisplayUrl('app://market/#/display')).toBe(true);
    expect(isDisplayUrl('app://market/index.html#/pos')).toBe(false);
    expect(isDisplayUrl('app://other/index.html#/display')).toBe(false);
    expect(isDisplayUrl('https://example.com/#/display')).toBe(false);
    expect(isDisplayUrl('not a url')).toBe(false);
  });

  it('goes full screen on a second monitor when there is one', () => {
    expect(displayBounds([laptop, monitor], laptop.id)).toEqual({
      bounds: monitor.bounds,
      fullscreen: true,
    });
  });

  it('opens as a window beside the register on a single screen', () => {
    expect(displayBounds([laptop], laptop.id)).toEqual({
      bounds: { x: 683, y: 0, width: 683, height: 768 },
      fullscreen: false,
    });
  });
});
