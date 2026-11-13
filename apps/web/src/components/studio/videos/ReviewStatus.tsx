'use client';

/**
 * Pre-publication review in Studio (wiki AUN-VIDEO-REVIEW, VR6/VR10): the row's review line and
 * the appeal dialog. Text, never colour alone; the status reads to screen readers as text.
 */
import { useState } from 'react';
import type { CreatorReviewView } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/hooks/useLanguage';

/** Minutes the automated check usually takes, from the review's own ETA (admin-editable, 5 by default). */
export function etaMinutes(review: Pick<CreatorReviewView, 'since' | 'etaAt'>): number {
  if (!review.etaAt) return 5;
  const minutes = Math.round((Date.parse(review.etaAt) - Date.parse(review.since)) / 60_000);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 5;
}

/** The line under a video's title while it is in review or after it was turned down. */
export function reviewLine(review: CreatorReviewView | undefined, queueMinutes: number | null | undefined, text: { checking: string; held: string; heldNoTime: string; appealed: string; rejected: string; reasons: Record<string, string> }): string | null {
  if (!review) return null;
  switch (review.status) {
    case 'checking':
      return text.checking.replace('{minutes}', String(etaMinutes(review)));
    case 'in_review':
      return queueMinutes ? text.held.replace('{minutes}', String(queueMinutes)) : text.heldNoTime;
    case 'appealed':
      return text.appealed;
    case 'rejected':
      return text.rejected.replace('{reason}', text.reasons[review.reasonCode ?? 'other'] ?? text.reasons.other ?? '');
    default:
      return null;
  }
}

export function ReviewLine({ review, queueMinutes }: { review: CreatorReviewView | undefined; queueMinutes: number | null | undefined }) {
  const { t } = useLanguage();
  const line = reviewLine(review, queueMinutes, t.studio.videos.review);
  if (!line) return null;
  return (
    <span className="mt-1 block text-xs text-muted-foreground" data-testid="studio-video-review" data-review-status={review?.status}>
      {line}
    </span>
  );
}

export function AppealDialog({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (open: boolean) => void; onSubmit: (message: string) => Promise<void> }) {
  const { t } = useLanguage();
  const text = t.studio.videos.review.appealDialog;
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(message.trim());
      setMessage('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="studio-review-appeal">
        <DialogHeader>
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>{text.body}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="studio-review-appeal-message">{text.label}</Label>
          <textarea
            id="studio-review-appeal-message"
            dir="auto"
            rows={4}
            maxLength={2000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full rounded-md border border-input bg-background p-2 text-sm text-foreground"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{text.cancel}</Button>
          <Button disabled={!message.trim() || busy} onClick={() => void submit()} data-testid="studio-review-appeal-submit">{text.submit}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
