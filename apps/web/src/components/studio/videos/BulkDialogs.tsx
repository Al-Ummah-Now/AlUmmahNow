'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/hooks/useLanguage';
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

  const submit = async () => {
    setBusy(true);
    const summary = await bulkScheduleVideos({
      videoIds,
      startAt: new Date(start).toISOString(),
      intervalMinutes: Number(interval) || 0,
      timezone,
    }).catch(() => null);
    setBusy(false);
    await onDone(summary);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{text.cancel}</Button>
          <Button disabled={!start || busy} onClick={() => void submit()}>{text.submit}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
