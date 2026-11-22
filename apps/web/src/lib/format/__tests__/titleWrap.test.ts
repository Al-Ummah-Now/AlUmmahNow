import { keepLastWordsTogether } from '../titleWrap';

describe('keepLastWordsTogether', () => {
  it('joins the last two words of a title with a no-break space', () => {
    expect(keepLastWordsTogether('Wudu for beginners')).toBe('Wudu for beginners');
    expect(keepLastWordsTogether('يوم عرفة خطوة بخطوة')).toBe('يوم عرفة خطوة\u00a0بخطوة');
  });

  it('leaves one- and two-word titles alone', () => {
    expect(keepLastWordsTogether('Wudu')).toBe('Wudu');
    expect(keepLastWordsTogether('Surah Yasin')).toBe('Surah Yasin');
  });

  it('leaves a pair too long for a narrow column to wrap', () => {
    expect(keepLastWordsTogether('A talk on extraordinarily misunderstood')).toBe('A talk on extraordinarily misunderstood');
  });

  it('joins an Arabic pair up to 17 letters, which fits the narrowest column in every font', () => {
    expect(keepLastWordsTogether('زكاة المدخرات بالتفصيل')).toBe('زكاة المدخرات\u00a0بالتفصيل');
    expect(keepLastWordsTogether('رمي الجمرات بالتفصيل')).toBe('رمي الجمرات\u00a0بالتفصيل');
  });

  it('gives Arabic, which runs wider in some fonts, a lower limit', () => {
    expect(keepLastWordsTogether('دروس في الاستغفار بالتفصيل')).toBe('دروس في الاستغفار بالتفصيل');
  });

  it('replaces only the last gap, whatever its whitespace', () => {
    expect(keepLastWordsTogether('The migration to  Madinah')).toBe('The migration to Madinah');
  });
});
