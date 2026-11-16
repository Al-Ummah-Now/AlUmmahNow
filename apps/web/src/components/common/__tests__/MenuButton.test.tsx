import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MenuButton } from '../MenuButton';

/**
 * The shared menu (comment ⋮, video card ⋮, …): a flat list on the frosted panel (theme/system.css
 * .menu / .mi, packages/fanous-tokens/surfaces). Icons come first in each row, so they sit at the
 * start edge (right in Arabic); a destructive row is marked for the theme's danger colour.
 */
describe('MenuButton', () => {
  const items = (onDelete = jest.fn()) => [
    { id: 'edit', label: 'تعديل', icon: <svg data-testid="ic-edit" />, onSelect: jest.fn() },
    { id: 'delete', label: 'حذف', icon: <svg data-testid="ic-delete" />, danger: true, onSelect: onDelete },
  ];

  it('opens from the keyboard and focuses the first row', () => {
    render(<MenuButton label="Comment actions" items={items()}>⋮</MenuButton>);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Comment actions' }), { key: 'ArrowDown' });
    const rows = screen.getAllByRole('menuitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveFocus();
  });

  it('puts each icon before its label and marks the destructive row', () => {
    const onDelete = jest.fn();
    render(<MenuButton label="Comment actions" items={items(onDelete)}>⋮</MenuButton>);
    fireEvent.click(screen.getByRole('button', { name: 'Comment actions' }));
    const del = screen.getByRole('menuitem', { name: 'حذف' });
    expect(del).toHaveAttribute('data-danger');
    expect(screen.getByRole('menuitem', { name: 'تعديل' })).not.toHaveAttribute('data-danger');
    // icon first in the row: with dir=rtl the row's start (and the icon) is on the right
    expect(del.firstElementChild?.querySelector('[data-testid=ic-delete]')).not.toBeNull();
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalled();
  });
});
