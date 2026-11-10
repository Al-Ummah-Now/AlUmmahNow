'use client';

import { Children, forwardRef, isValidElement, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import * as Menu from '@radix-ui/react-dropdown-menu';

interface Item { value: string; label: string; disabled: boolean; group?: string }

const textOf = (node: ReactNode): string => Children.toArray(node).map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : isValidElement(c) ? textOf((c.props as { children?: ReactNode }).children) : '')).join('');

function readOptions(node: ReactNode, group?: string): Item[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const props = child.props as { value?: unknown; children?: ReactNode; disabled?: boolean; label?: string };
    if (child.type === 'option') {
      const label = textOf(props.children);
      return [{ value: props.value === undefined ? label : String(props.value), label, disabled: !!props.disabled, group }];
    }
    return readOptions(props.children, child.type === 'optgroup' ? props.label : group);
  });
}

/**
 * Themed drop-in for a native select. A real select stays in the DOM, visually hidden,
 * so form submission, refs, change handlers and selectOption keep working.
 */
export const ThemedSelectField = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function ThemedSelectField({ children, className = '', id, 'aria-label': ariaLabel, 'aria-labelledby': labelledBy, ...rest }, ref) {
  const select = useRef<HTMLSelectElement>(null);
  useImperativeHandle(ref, () => select.current as HTMLSelectElement);
  const items = readOptions(children);
  const [current, setCurrent] = useState(String(rest.value ?? rest.defaultValue ?? items[0]?.value ?? ''));
  const [dir, setDir] = useState<'ltr' | 'rtl'>('ltr');
  useLayoutEffect(() => { if (select.current) setCurrent(select.current.value); }, [rest.value, children]);
  const pick = useCallback((value: string) => {
    const el = select.current;
    if (!el) return;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    setCurrent(el.value);
  }, []);
  const label = items.find((i) => i.value === current)?.label ?? '';
  const wide = /(^|\s)(w-full|flex-1|grow)(\s|$)/.test(className);
  let lastGroup: string | undefined;
  return (
    <span className="tsf" data-wide={wide || undefined}>
      <select {...rest} ref={select} className="tsf-native" tabIndex={-1} aria-hidden="true" onChange={(e) => { setCurrent(e.target.value); rest.onChange?.(e); }}>{children}</select>
      <Menu.Root modal={false} dir={dir} onOpenChange={(o) => { if (o) setDir(document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr'); }}>
        <Menu.Trigger id={id} className="tsf-trigger" disabled={rest.disabled} aria-label={ariaLabel ?? undefined} aria-labelledby={labelledBy}>
          <span className="tsf-value">{label}</span>
          <ChevronDown aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content data-slot="dropdown-menu-content" className="menu tsf-menu" align="start" sideOffset={4} collisionPadding={8}>
            <Menu.RadioGroup value={current} onValueChange={pick}>
              {items.map((item) => {
                const heading = item.group && item.group !== lastGroup ? item.group : null;
                lastGroup = item.group;
                return (
                  <span key={item.value} style={{ display: 'contents' }}>
                    {heading && <Menu.Label className="tsf-group">{heading}</Menu.Label>}
                    <Menu.RadioItem value={item.value} disabled={item.disabled} className="ts-item">
                      <span className="ts-check"><Menu.ItemIndicator><Check size={18} aria-hidden="true" /></Menu.ItemIndicator></span>
                      {item.label}
                    </Menu.RadioItem>
                  </span>
                );
              })}
            </Menu.RadioGroup>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </span>
  );
});
