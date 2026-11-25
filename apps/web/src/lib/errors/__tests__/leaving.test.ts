import { isLeavingPage, resetLeaving, watchLeaving } from '../leaving';

function fakeWindow() {
  const navigation = new EventTarget();
  const win = Object.assign(new EventTarget(), { navigation }) as unknown as Window;
  const navigate = (init: { sameDocument: boolean; downloadRequest?: string | null }) =>
    navigation.dispatchEvent(Object.assign(new Event('navigate'), { destination: { sameDocument: init.sameDocument }, downloadRequest: init.downloadRequest ?? null }));
  return { win, navigate };
}

describe('leaving the page', () => {
  beforeEach(resetLeaving);

  it('is a navigation to another document, not one inside the app and not a download', () => {
    const { win, navigate } = fakeWindow();
    const stop = watchLeaving(win);
    navigate({ sameDocument: true });
    navigate({ sameDocument: false, downloadRequest: '' });
    expect(isLeavingPage()).toBe(false);
    navigate({ sameDocument: false });
    expect(isLeavingPage()).toBe(true);
    expect(isLeavingPage(Date.now() + 20_000)).toBe(false);
    win.dispatchEvent(new Event('pageshow'));
    expect(isLeavingPage()).toBe(false);
    stop();
    navigate({ sameDocument: false });
    expect(isLeavingPage()).toBe(false);
  });

  it('works without the Navigation API', () => {
    const stop = watchLeaving(new EventTarget() as unknown as Window);
    expect(isLeavingPage()).toBe(false);
    stop();
  });
});
