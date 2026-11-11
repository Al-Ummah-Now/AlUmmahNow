import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { OptionCard } from '../OptionCard';

function Group() {
  const [value, setValue] = useState('a');
  return (
    <fieldset>
      <legend>Visibility</legend>
      <OptionCard name="v" checked={value === 'a'} onSelect={() => setValue('a')} title="Public" help="Anyone can view" testId="card-a" inputTestId="input-a" />
      <OptionCard name="v" checked={value === 'b'} onSelect={() => setValue('b')} title="Private" help="Only you" testId="card-b" inputTestId="input-b" disabled={false} />
    </fieldset>
  );
}

it('is a real radio named by its title and help; the selected card is marked with a check', () => {
  render(<Group />);
  const pub = screen.getByRole('radio', { name: /Public\s*Anyone can view/ });
  expect(pub).toBeChecked();
  expect(screen.getByTestId('card-a')).toHaveAttribute('data-checked', 'true');
  expect(screen.getByTestId('card-a').querySelector('.ocard-mark svg')).not.toBeNull();
  expect(screen.getByTestId('card-b').querySelector('.ocard-mark svg')).toBeNull();
  fireEvent.click(screen.getByTestId('input-b'));
  expect(screen.getByRole('radio', { name: /Private/ })).toBeChecked();
  expect(screen.getByTestId('card-b')).toHaveAttribute('data-checked', 'true');
  expect(screen.getByTestId('card-a')).not.toHaveAttribute('data-checked');
});

it('a disabled card cannot be chosen', () => {
  const onSelect = jest.fn();
  render(<OptionCard name="x" checked={false} onSelect={onSelect} title="Later" disabled testId="c" />);
  expect(screen.getByRole('radio', { name: 'Later' })).toBeDisabled();
  expect(screen.getByTestId('c')).toHaveAttribute('data-disabled', 'true');
});
