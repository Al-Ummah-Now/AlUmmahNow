/** Shared by the tests of the screens whose action the server may refuse with `terms_required` (#1929). */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

export const refusal = { success: false, code: 'terms_required', error: 'x' };

export const modal = () => screen.queryByTestId('creator-terms-modal');

export async function accept() {
  fireEvent.click(await screen.findByTestId('creator-terms-checkbox'));
  await act(async () => {
    fireEvent.click(screen.getByTestId('creator-terms-agree'));
  });
}

interface Screen {
  /** Does the gated action (its call is refused the first time) */
  act: () => void | Promise<void>;
  /** The mock the action calls; refused first, `ok` later */
  call: jest.Mock;
  refuse: (mock: jest.Mock) => void;
  ok: (mock: jest.Mock) => void;
  /** The test id of "Review Terms" beside the message */
  review: string;
}

/** One prompt; dismissed, the message stays with Review Terms; accepting does the same action once more. */
export async function asksOnceAndGoesOn({ act: doIt, call, refuse, ok, review }: Screen) {
  refuse(call);
  await doIt();
  await waitFor(() => expect(modal()).toBeInTheDocument());
  expect(call).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByTestId('creator-terms-cancel'));
  await waitFor(() => expect(modal()).toBeNull());
  expect(call).toHaveBeenCalledTimes(1);
  fireEvent.click(await screen.findByTestId(review));
  expect(modal()).toBeInTheDocument();
  ok(call);
  await accept();
  await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
  const sent = (args: unknown[]) => args.filter((a) => a !== undefined && !(a instanceof AbortSignal));
  expect(sent(call.mock.calls[1])).toEqual(sent(call.mock.calls[0]));
  await waitFor(() => expect(screen.queryByTestId(review)).toBeNull());
  expect(modal()).toBeNull();
}

/** Refused again right after accepting (an older server during a rollout): said, and not asked in a loop. */
export async function doesNotAskInALoop({ act: doIt, call, refuse, review }: Screen) {
  refuse(call);
  await doIt();
  await waitFor(() => expect(modal()).toBeInTheDocument());
  refuse(call);
  await accept();
  await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
  expect(await screen.findByTestId(review)).toBeInTheDocument();
  expect(modal()).toBeNull();
}
