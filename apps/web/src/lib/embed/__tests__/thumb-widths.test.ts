import { sizedImageSource, thumbSrcSet, thumbWidth } from '../share-image';

describe('/thumb width variants', () => {
  it('should accept only the served widths', () => {
    expect(thumbWidth('320')).toBe(320);
    expect(thumbWidth('1280')).toBe(1280);
    expect(thumbWidth('300')).toBeNull();
    expect(thumbWidth(null)).toBeNull();
  });

  it('should give a srcset for a /thumb path only', () => {
    expect(thumbSrcSet('/thumb/v1.jpg')).toBe('/thumb/v1.jpg?w=320 320w, /thumb/v1.jpg?w=480 480w, /thumb/v1.jpg?w=640 640w, /thumb/v1.jpg?w=1280 1280w');
    expect(thumbSrcSet('https://vz-1.b-cdn.net/v1/thumbnail.jpg?token=t&expires=1')).toBeUndefined();
    expect(thumbSrcSet(undefined)).toBeUndefined();
  });

  it('should resize on the Optimizer image host only', () => {
    expect(sizedImageSource('https://images.alummahnow.net/t/v1/custom.jpg?width=1280&quality=90', 640)).toBe('https://images.alummahnow.net/t/v1/custom.jpg?width=640&quality=85');
    const signed = 'https://vz-1.b-cdn.net/v1/thumbnail.jpg?token=t&expires=1';
    expect(sizedImageSource(signed, 320)).toBe(signed);
    expect(sizedImageSource('https://images.alummahnow.net/a.jpg', null)).toBe('https://images.alummahnow.net/a.jpg');
  });
});
