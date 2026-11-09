'use client';
// Prototype only: the player's error state, an unlit lantern with a clear way forward.
import { Flag, RotateCcw } from 'lucide-react';

export interface PlayerErrorProps { title: string; description: string; retryLabel: string; onRetry?: () => void; fallbackLabel?: string; onFallback?: () => void; reportLabel: string; onReport: () => void; dir: 'ltr' | 'rtl' }

export function PlayerErrorView({ title, description, retryLabel, onRetry, fallbackLabel, onFallback, reportLabel, onReport, dir }: PlayerErrorProps) {
  return (
    <div className="pe" role="alert" dir={dir}>
      <div className="pe-in">
        <svg className="pe-g" viewBox="-30 0 60 104" fill="none" stroke="var(--fanous-color-primary)" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
          <circle cy="4" r="3" /><path d="M0 7V12M-21 37C-25 24-6 21 0 9C6 21 25 24 21 37ZM-24 41L-13 37H13L24 41V88L13 92H-13L-24 88ZM-27 92H27L23 100H-23Z" /><path d="M-8 86V60C-8 52-2 50 0 43C2 50 8 52 8 60V86Z" strokeDasharray="3 4" />
        </svg>
        <h3>{title}</h3>
        <p>{description}</p>
        <div className="pe-a">
          {onRetry && <button type="button" className="b b-primary" onClick={onRetry}><RotateCcw aria-hidden="true" />{retryLabel}</button>}
          {onFallback && fallbackLabel && <button type="button" className="b b-secondary" onClick={onFallback}>{fallbackLabel}</button>}
          <button type="button" className="b b-secondary" onClick={onReport}><Flag aria-hidden="true" />{reportLabel}</button>
        </div>
      </div>
    </div>
  );
}
