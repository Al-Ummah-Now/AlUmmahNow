/**
 * #1058: the header was thrown away and built again after a Server Action or router.refresh() (focus,
 * typed search and the open menu lost). The root layout is a server component, and in a later payload
 * the type of the component it places can be a lazy reference to the same module export: React must
 * then keep what is mounted.
 */
import React from 'react';
import { render } from '@testing-library/react';
import Navigation from '..';

let mockUser: { id: string } | null = { id: 'u1' };
jest.mock('@/components/AuthProvider/authContext', () => ({ useOptionalAuth: () => ({ user: mockUser }) }));
jest.mock('@/components/ThemeDemo/AppShell', () => ({ AppShell: () => jest.requireActual('react').createElement('header', { className: 'ah' }) }));

/** An element type as a server payload's client reference can be: lazy, already resolved */
const asLazyReference = (component: unknown) =>
  ({ $$typeof: Symbol.for('react.lazy'), _payload: component, _init: (loaded: unknown) => loaded }) as unknown as React.ComponentType;

const page = (type: React.ComponentType) => <div>{React.createElement(type)}</div>;

beforeEach(() => { mockUser = { id: 'u1' }; });

it('keeps the same header node when a later payload refers to it lazily', () => {
  const { container, rerender } = render(page(Navigation));
  const header = container.querySelector('header');
  rerender(page(asLazyReference(Navigation)));
  expect(container.querySelector('header')).toBe(header);
  rerender(page(asLazyReference(Navigation)));
  expect(container.querySelector('header')).toBe(header);
});

it('starts a new header when another account is signed in', () => {
  const { container, rerender } = render(page(Navigation));
  const header = container.querySelector('header');
  mockUser = { id: 'u2' };
  rerender(page(asLazyReference(Navigation)));
  expect(container.querySelector('header')).not.toBe(header);
});
