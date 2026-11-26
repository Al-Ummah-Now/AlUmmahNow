import { render, screen } from '@testing-library/react';
import { WatchSources } from '../WatchSources';

test.each([
  ['en', 'Sources: Quran Foundation', 'Quran Foundation (opens in a new tab)', 'ltr'],
  ['ar', 'المصادر: مؤسسة القرآن', 'مؤسسة القرآن (يفتح في علامة تبويب جديدة)', 'rtl'],
])('shows the linked source in %s', (lang, text, name, dir) => {
  const { container } = render(<WatchSources lang={lang} sources={['quranFoundation']} />);
  expect(container.firstChild).toHaveTextContent(text);
  expect(container.firstChild).toHaveAttribute('dir', dir);
  const link = screen.getByRole('link', { name });
  expect(link).toHaveAttribute('href', 'https://quran.foundation/');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener');
});

test('omits the credit without a source or while the switch is off', () => {
  const { container, rerender } = render(<WatchSources lang="en" />);
  expect(container).toBeEmptyDOMElement();
  rerender(<WatchSources lang="en" sources={['quranFoundation']} enabled={false} />);
  expect(container).toBeEmptyDOMElement();
});
