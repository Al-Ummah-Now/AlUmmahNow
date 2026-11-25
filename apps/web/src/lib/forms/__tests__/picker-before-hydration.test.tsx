/** A photo's Change button opens its picker whether or not React has hydrated it, and only once. */
import React from 'react';
import { act } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { EditableAvatar } from '@/components/media/ProfileImages';
import { PhotoFileInput } from '@/components/media/PhotoFileInput';
import { PICKER_BEFORE_HYDRATION_SCRIPT } from '../picker-before-hydration';

const labels = { pick: 'Click to change avatar', change: 'Change photo', remove: 'Remove photo' };
const onPick = jest.fn();

function Form() {
  return (
    <>
      <EditableAvatar url="https://images.example.com/a.jpg" alt="me" inputId="photo" labels={labels} testId="ea" imageTestId="ea-img" busy />
      <PhotoFileInput id="photo" label="photo" onPick={onPick} />
    </>
  );
}

describe('file pickers before hydration', () => {
  let opened = 0;
  let container: HTMLDivElement;
  const clickSpy = jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => void opened++);

  beforeAll(() => {
    new Function(PICKER_BEFORE_HYDRATION_SCRIPT)();
  });
  afterAll(() => clickSpy.mockRestore());
  beforeEach(() => {
    opened = 0;
    onPick.mockClear();
    container = document.createElement('div');
    container.innerHTML = renderToString(<Form />);
    document.body.append(container);
  });
  afterEach(() => container.remove());

  const press = (sel: string) => container.querySelector(sel)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

  it('opens from the server HTML, from the button and the photo, also while a photo uploads', () => {
    press('[data-testid=ea-change]');
    press('[data-testid=ea-change] svg');
    press('[data-testid=ea]');
    expect(opened).toBe(3);
  });

  it('opens once per click after hydration', async () => {
    await act(async () => {
      hydrateRoot(container, <Form />);
    });
    press('[data-testid=ea-change]');
    expect(opened).toBe(1);
    press('[data-testid=ea]');
    expect(opened).toBe(2);
  });

  it('a photo picked before hydration is taken by the form', async () => {
    const file = new File(['x'], 'me.jpg', { type: 'image/jpeg' });
    const input = container.querySelector<HTMLInputElement>('#photo')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    Object.defineProperty(input, 'value', { configurable: true, writable: true, value: 'me.jpg' });
    await act(async () => {
      hydrateRoot(container, <Form />);
    });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(file);
  });
});
