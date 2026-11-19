'use client';

/**
 * The admin's number field (#1643): a text box with the numeric keyboard (inputMode) that shows the
 * admin's digits, ٠–٩ and «٫» in Arabic, where a native type="number" box only ever shows 0–9.
 * Either digit set may be typed. Handlers get the value in Latin digits (`e.target.value`, as from a
 * number input), and with `name` a hidden input submits the Latin value, so parsing and server
 * actions are unchanged. min/max/step become the field's own validity message in the admin's
 * language (the browser blocks the submit as it did for the number input).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { latinOf, numberProblem, showNumber, toLatinNumber } from './number-text';

export interface NumberChangeTarget {
  value: string;
  name?: string;
  form: HTMLFormElement | null;
}

export interface NumberChangeEvent {
  target: NumberChangeTarget;
  currentTarget: NumberChangeTarget;
}

type InputAttrs = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max' | 'step' | 'inputMode'>;

export interface NumberFieldProps extends InputAttrs {
  value?: string | number | null;
  defaultValue?: string | number | null;
  onChange?: (e: NumberChangeEvent) => void;
  min?: string | number;
  max?: string | number;
  /** As on a number input: a whole step (the default, 1) allows whole numbers only; "any" or a fraction allows decimals. */
  step?: string | number;
  /** Decimals allowed regardless of step (money fields). */
  decimal?: boolean;
}

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function NumberField(props: NumberFieldProps) {
  const { value, defaultValue, onChange, min, max, step, decimal: decimalProp, name, ...rest } = props;
  const { locale, t } = useLanguage();
  const decimal = decimalProp || step === 'any' || (step !== undefined && !Number.isInteger(Number(step)));
  const negative = min !== undefined && Number(min) < 0;
  const controlled = value !== undefined;
  const [inner, setInner] = useState(() => latinOf(defaultValue));
  // What is typed, in Latin digits; kept apart from the value so "1." stays while typing "1.5"
  const [typed, setTyped] = useState(() => (controlled ? latinOf(value) : latinOf(defaultValue)));
  const latin = controlled ? latinOf(value) : inner;
  const ref = useRef<HTMLInputElement | null>(null);

  // A new value from outside (a reset, a save, another control) replaces what is shown
  useEffect(() => {
    if (Number(typed) !== Number(latin) || (typed === '') !== (latin === '')) setTyped(latin);
    // only when the value itself changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latin]);

  const problem = numberProblem(typed, { min, max, whole: !decimal });
  const fmt = (n: number | undefined) => (n === undefined ? '' : showNumber(locale, String(n)));
  const message = problem ? t(`numberField.${problem.key}`, { min: fmt(problem.min), max: fmt(problem.max) }) : '';
  useIsoLayoutEffect(() => {
    ref.current?.setCustomValidity(message);
  }, [message]);

  // A form reset puts an uncontrolled field back on its starting value
  useEffect(() => {
    const form = ref.current?.form;
    if (!form || controlled) return;
    const reset = () => {
      const start = latinOf(defaultValue);
      setInner(start);
      setTyped(start);
    };
    form.addEventListener('reset', reset);
    return () => form.removeEventListener('reset', reset);
  }, [controlled, defaultValue]);

  return (
    <>
      <input
        {...rest}
        ref={ref}
        type="text"
        inputMode={decimal ? 'decimal' : 'numeric'}
        autoComplete={rest.autoComplete ?? 'off'}
        value={showNumber(locale, typed)}
        aria-invalid={rest['aria-invalid'] ?? (problem ? true : undefined)}
        data-value={typed}
        onChange={(e) => {
          const next = toLatinNumber(e.target.value, { decimal, negative });
          setTyped(next);
          if (!controlled) setInner(next);
          const target: NumberChangeTarget = { value: next, name, form: e.currentTarget.form };
          onChange?.({ target, currentTarget: target });
        }}
      />
      {name !== undefined ? <input type="hidden" name={name} value={typed} readOnly /> : null}
    </>
  );
}
