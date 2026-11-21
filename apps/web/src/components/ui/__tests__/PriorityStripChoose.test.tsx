/**
 * The item chosen from "More" takes a slot in the row (#1669), also when the choice arrives in a
 * transition (a navigation) and a resize observer set up for an earlier render fires afterwards:
 * the row comes from the current item on every render, never from a remembered older choice.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { startTransition, useState } from 'react';
import { PriorityStrip } from '../PriorityStrip';

const IDS = ['a', 'b', 'c', 'd', 'e'];

function Strip() {
  const [current, setCurrent] = useState('a');
  const items = IDS.map((id) => ({ id, label: `Item ${id}`, current: id === current }));
  return (
    <>
      <button type="button" data-testid="navigate-e" onClick={() => startTransition(() => setCurrent('e'))}>
        e
      </button>
      <PriorityStrip
        items={items}
        testId="s"
        moreLabel="More"
        menuLabel="More items"
        onSelect={(item) => setCurrent(item.id)}
        renderItem={(item) => (
          <button type="button" key={item.id} data-testid={`row-${item.id}`} aria-pressed={item.current}>
            {item.label}
          </button>
        )}
      />
    </>
  );
}

const rowIds = () => screen.queryAllByTestId(/^row-/).map((el) => el.dataset.testid);
const observerCallbacks: Array<() => void> = [];

beforeAll(() => {
  // Every item and More are 100px wide and the strip 330px: two items beside More
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
  );
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 330 });
  (global as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    constructor(callback: () => void) {
      observerCallbacks.push(callback);
    }
    observe() {}
    disconnect() {}
  };
});

it('puts the item chosen in a transition in the row, and an older observer firing later keeps it there', async () => {
  render(<Strip />);
  await act(async () => {});
  expect(rowIds()).toEqual(['row-a', 'row-b']);
  const observerBefore = observerCallbacks[observerCallbacks.length - 1];

  fireEvent.click(screen.getByTestId('navigate-e'));
  await act(async () => {});
  expect(rowIds()).toEqual(['row-a', 'row-e']);

  act(() => observerBefore());
  expect(rowIds()).toEqual(['row-a', 'row-e']);
});
