'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/hooks/useLanguage';
import { useCreatorTermsPrompt } from '@/components/legal/useCreatorTermsPrompt';
import { bulkScheduleVideos, type BulkSummary } from '@/lib/api/studio-content';
import type { LimitRefusal } from '@/lib/studio/limits';

interface DialogProps {
  open: boolean;
  videoIds: string[];
  onOpenChange: (open: boolean) => void;
  onDone: (summary: BulkSummary | LimitRefusal | null) => void | Promise<void>;
}

export function BulkScheduleDialog({ open, videoIds, onOpenChange, onDone }: DialogProps) {
  const { t } = useLanguage();
  const text = t.studio.videos.bulkSchedule;
  const [start, setStart] = useState('');
  const [interval, setIntervalMinutes] = useState('0');
  const [busy, setBusy] = useState(false);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const terms = useCreatorTermsPrompt(() => submit());

  const submit = async () => {
    terms.clear();
    setBusy(true);
    const summary = await bulkScheduleVideos({
      videoIds,
      startAt: new Date(start).toISOString(),
      intervalMinutes: Number(interval) || 0,
      timezone,
    }).catch(() => null);
    setBusy(false);
    // The dialog stays, with its values, until the Terms are accepted
    if (summary && 'termsRequired' in summary) terms.refused();
    else await onDone(summary);
  };

  const change = (next: boolean) => {
    if (!next) terms.clear();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        <DialogHeader><DialogTitle>{text.title}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="studio-bulk-start">{text.start}</Label>
            <Input id="studio-bulk-start" type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} className="min-h-11" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="studio-bulk-interval">{text.interval}</Label>
            <Input id="studio-bulk-interval" type="number" min={0} value={interval} onChange={(event) => setIntervalMinutes(event.target.value)} className="min-h-11" />
          </div>
          <p className="text-sm text-muted-foreground">{text.timezone.replace('{zone}', timezone)}</p>
          {terms.needed && (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-[var(--fanous-color-error-text)]" data-testid="studio-bulk-schedule-terms">
              <span>{t.creator.termsRequired}</span>
              {terms.reviewLink('studio-bulk-schedule-review-terms')}
            </div>
          )}
        </div>
        {terms.dialog}
        <DialogFooter>
          <Button variant="outline" onClick={() => change(false)}>{text.cancel}</Button>
          <Button disabled={!start || busy} onClick={() => void submit()} data-testid="studio-bulk-schedule-submit">{text.submit}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
