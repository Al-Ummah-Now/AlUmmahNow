'use client';

/**
 * The Features page switch: a real switch (role="switch", 44 px tap target) with its state in
 * words beside it, never colour alone (wiki AUN-FEATURES §3). "Paused" is a switch that is on but
 * waits for a feature it needs; "Off here" is the environment override, locked.
 */
import type { SwitchWords } from '@/lib/features/page-model';
import { useLanguage } from '@/i18n/I18nProvider';
import { Icon } from '@/components/shell/icons';

const WORDS_CLASS: Record<SwitchWords, string> = {
  on: 'text-fg',
  off: 'text-fg-muted',
  waiting: 'text-fg',
  envOff: 'text-fg-muted',
};

const DOT_CLASS: Record<SwitchWords, string> = {
  on: 'bg-success-fg',
  off: 'border-2 border-fg-muted',
  waiting: 'bg-warning-fg',
  envOff: 'border-2 border-fg-muted',
};

export function FeatureSwitch({
  checked,
  words,
  labelledBy,
  describedBy,
  locked,
  busy,
  onChange,
  testId,
}: {
  checked: boolean;
  words: SwitchWords;
  labelledBy: string;
  describedBy?: string;
  locked: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
  testId: string;
}) {
  const { t } = useLanguage();
  const stateId = `${labelledBy}-state`;
  const waiting = words === 'waiting';
  const track = checked ? (waiting ? 'bg-chip-pending-bg border-warning-fg border-dashed' : 'bg-accent border-accent') : 'bg-surface-2 border-fg-subtle';
  const knob = checked ? (waiting ? 'bg-warning-fg' : 'bg-on-accent') : 'bg-fg-muted';
  return (
    <div className="flex shrink-0 items-center gap-2" data-testid={`${testId}-control`}>
      <span id={stateId} className={`inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap ${WORDS_CLASS[words]}`} data-testid={`${testId}-words`} data-words={words}>
        {locked ? <Icon name="lock" className="size-3.5" /> : <span aria-hidden="true" className={`inline-block size-2 rounded-full ${DOT_CLASS[words]}`} />}
        {t(`features.state.${words}`)}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelledBy}
        aria-describedby={[stateId, describedBy].filter(Boolean).join(' ')}
        aria-busy={busy || undefined}
        disabled={locked || busy}
        onClick={() => onChange(!checked)}
        className="group relative inline-flex h-11 w-14 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed"
        data-testid={testId}
        data-checked={String(checked)}
      >
        <span aria-hidden="true" className={`relative block h-6 w-11 rounded-full border transition-colors ${track} ${locked ? 'opacity-50' : ''} ${busy ? 'animate-pulse' : ''}`}>
          <span
            className={`absolute top-1/2 start-0.5 block size-[18px] -translate-y-1/2 rounded-full shadow transition-transform ${knob} ${checked ? 'translate-x-5 rtl:-translate-x-5' : ''}`}
          />
        </span>
      </button>
    </div>
  );
}
