import { placeInBand, BAND_MARGIN, type VisibleBand } from '../visible-band';

const rect = (top: number, left: number, width = 32, height = 32) =>
  ({ top, left, width, height, bottom: top + height, right: left + width, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

// A 360×740 phone: sticky header to 64, tab bar from 684
const band: VisibleBand = { top: 64, bottom: 684, left: 0, right: 360 };
const menu = { width: 240, height: 56 };

describe('placeInBand', () => {
  it('opens below the button when it fits', () => {
    const p = placeInBand(rect(200, 300), menu, band, false);
    expect(p.side).toBe('bottom');
    expect(p.top).toBe(236);
  });

  it('flips above a button just over the tab bar', () => {
    const anchor = rect(646, 300);
    const p = placeInBand(anchor, menu, band, false);
    expect(p.side).toBe('top');
    expect(p.top + menu.height).toBeLessThanOrEqual(anchor.top);
    expect(p.top + menu.height).toBeLessThanOrEqual(band.bottom - BAND_MARGIN);
  });

  it('opens below a button just under the header', () => {
    const p = placeInBand(rect(66, 300), menu, band, false);
    expect(p.side).toBe('bottom');
    expect(p.top).toBeGreaterThanOrEqual(band.top + BAND_MARGIN);
  });

  it('lines up the end edge with the button and stays on screen (LTR and RTL)', () => {
    const ltr = placeInBand(rect(200, 300), menu, band, false);
    expect(ltr.left + menu.width).toBe(332);
    const rtl = placeInBand(rect(200, 16), menu, band, true);
    expect(rtl.left).toBe(16);
    const rtlEdge = placeInBand(rect(200, 300), menu, band, true);
    expect(rtlEdge.left + menu.width).toBeLessThanOrEqual(band.right - BAND_MARGIN);
  });

  it('caps a menu taller than the band and keeps it inside', () => {
    const p = placeInBand(rect(400, 300), { width: 240, height: 2000 }, band, false);
    expect(p.maxHeight).toBe(band.bottom - band.top - 2 * BAND_MARGIN);
    expect(p.top).toBeGreaterThanOrEqual(band.top + BAND_MARGIN);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(band.bottom - BAND_MARGIN);
  });

  it('keeps the menu in the band when the button is partly under the tab bar', () => {
    const p = placeInBand(rect(670, 300), menu, band, false);
    expect(p.top + menu.height).toBeLessThanOrEqual(band.bottom - BAND_MARGIN);
  });
});
