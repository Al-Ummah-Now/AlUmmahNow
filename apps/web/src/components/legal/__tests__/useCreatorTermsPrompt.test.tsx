/** The creator Terms prompt of a screen: one prompt, one retry with what the screen holds now, no loop. */
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EN_TRANSLATIONS as mockEn } from '@al-ummah/shared-types';
import { useCreatorTermsPrompt, type CreatorTermsPrompt } from '../useCreatorTermsPrompt';
import { accept, modal } from './terms-testkit';

const mockMark = jest.fn();
const mockAccept = jest.fn();
let mockAccepted: boolean | undefined;
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: mockEn, lang: 'en', dir: 'ltr', isRTL: false }) }));
jest.mock('@/hooks/useCreatorAccess', () => ({
  useCreatorAccess: () => ({ status: 'ready', access: { termsAccepted: mockAccepted } }),
  needsCreatorTerms: (c: { access: { termsAccepted?: boolean } }) => c.access.termsAccepted === false,
  markCreatorTermsRequired: () => mockMark(),
  acceptCreatorTerms: (...a: unknown[]) => mockAccept(...a),
}));

const onRetry = jest.fn();
function Screen({ quiet = false }: { quiet?: boolean }) {
  const [text, setText] = useState('first');
  const terms: CreatorTermsPrompt<string> = useCreatorTermsPrompt<string>((what) => onRetry(what, text, terms));
  return (
    <>
      <input aria-label="text" value={text} onChange={(e) => setText(e.target.value)} />
      <button onClick={() => terms.refused('a', { quiet })}>refuse</button>
      <button onClick={() => terms.askFirst({ status: 'ready', access: { termsAccepted: mockAccepted } } as never, 'b')}>ask</button>
      <button onClick={terms.clear}>clear</button>
      {terms.reviewLink('review')}
      {terms.dialog}
    </>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAccepted = false;
  mockAccept.mockResolvedValue({ ok: true });
});

it('asks once, says so after Cancel, and runs the action again with what the screen holds by then', async () => {
  render(<Screen />);
  expect(screen.queryByTestId('review')).toBeNull();
  fireEvent.click(screen.getByText('refuse'));
  expect(mockMark).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByTestId('creator-terms-cancel'));
  await waitFor(() => expect(modal()).toBeNull());
  expect(onRetry).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('text'), { target: { value: 'edited' } });
  fireEvent.click(screen.getByTestId('review'));
  await accept();
  await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
  expect(onRetry.mock.calls[0].slice(0, 2)).toEqual(['a', 'edited']);
  expect(screen.queryByTestId('review')).toBeNull();
  expect(modal()).toBeNull();
});

it('an acceptance that is not saved retries nothing and stays open', async () => {
  mockAccept.mockResolvedValue({ ok: false });
  render(<Screen />);
  fireEvent.click(screen.getByText('refuse'));
  await accept();
  expect(await screen.findByTestId('creator-terms-error')).toBeInTheDocument();
  expect(onRetry).not.toHaveBeenCalled();
  expect(modal()).toBeInTheDocument();
});

it('refused again by the retry: says so, without asking again; a later refusal asks again', async () => {
  onRetry.mockImplementationOnce(async (_what: string, _text: string, terms: { refused: (w: string) => void }) => {
    await Promise.resolve();
    terms.refused('a');
  });
  render(<Screen />);
  fireEvent.click(screen.getByText('refuse'));
  await accept();
  expect(await screen.findByTestId('review')).toBeInTheDocument();
  expect(modal()).toBeNull();
  expect(onRetry).toHaveBeenCalledTimes(1);
  await act(async () => undefined);
  fireEvent.click(screen.getByText('refuse'));
  expect(modal()).toBeInTheDocument();
});

it('asks first when the account is known not to have accepted, and then goes on', async () => {
  render(<Screen />);
  fireEvent.click(screen.getByText('ask'));
  expect(mockMark).not.toHaveBeenCalled();
  await accept();
  await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
  expect(onRetry.mock.calls[0][0]).toBe('b');
});

it.each([true, undefined])('does not ask first when accepted is %p', (value) => {
  mockAccepted = value;
  render(<Screen />);
  fireEvent.click(screen.getByText('ask'));
  expect(modal()).toBeNull();
});

it('a quiet refusal and a cleared one', () => {
  render(<Screen quiet />);
  fireEvent.click(screen.getByText('refuse'));
  expect(modal()).toBeNull();
  expect(screen.getByTestId('review')).toBeInTheDocument();
  fireEvent.click(screen.getByText('clear'));
  expect(screen.queryByTestId('review')).toBeNull();
});
