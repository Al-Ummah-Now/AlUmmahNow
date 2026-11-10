import { menuShift } from '../menu-shift';

describe('SaveToPlaylist menuShift', () => {
  it('leaves a menu that fits where it is', () => {
    expect(menuShift(100, 388, 1440)).toBe(0);
  });

  it('brings a menu hanging off the left edge back (Safari, x = -183)', () => {
    expect(menuShift(-183, 105, 390)).toBe(191);
  });

  it('brings a menu hanging off the right edge back', () => {
    expect(menuShift(250, 538, 390)).toBe(-156);
  });

  it('keeps the start edge in view when the menu is as wide as the viewport allows', () => {
    expect(menuShift(-10, 364, 390)).toBe(18);
  });
});
