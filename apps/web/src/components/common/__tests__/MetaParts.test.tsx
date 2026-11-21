import React from 'react';
import { render } from '@testing-library/react';
import { MetaParts } from '../MetaParts';

const parts = [
  { key: 'a', keep: true, node: 'قبل ٣٦ دقيقة' },
  { key: 'b', keep: true, node: 'تمت مشاهدة ٣٨٪' },
];

describe('MetaParts', () => {
  it('joins Arabic parts with «،» kept on the part before it, never •', () => {
    const { container } = render(<p><MetaParts lang="ar" parts={parts} /></p>);
    expect(container.textContent).toBe('قبل ٣٦ دقيقة، تمت مشاهدة ٣٨٪');
    expect(container.querySelectorAll('[data-meta-part]')[0].textContent).toBe('قبل ٣٦ دقيقة،');
  });

  it('puts the English bullet with the part after it', () => {
    const { container } = render(<p><MetaParts lang="en" parts={[{ key: 'a', node: '36 minutes ago' }, { key: 'b', keep: true, node: '38% watched' }]} /></p>);
    expect(container.textContent).toBe('36 minutes ago • 38% watched');
    expect(container.querySelectorAll('[data-meta-part]')[1]).toHaveClass('whitespace-nowrap');
  });

  it('stacks with no separator when asked, and only hides it on phones for "phone"', () => {
    const always = render(<p><MetaParts lang="en" stack="always" parts={parts} /></p>);
    expect(always.container.textContent).not.toMatch(/[•،]/);
    expect(always.container.querySelectorAll('[data-meta-part].block')).toHaveLength(2);
    const phone = render(<p><MetaParts lang="ar" stack="phone" parts={parts} /></p>);
    expect(phone.container.querySelector('.hidden.sm\\:inline')?.textContent).toBe('،');
  });
});
