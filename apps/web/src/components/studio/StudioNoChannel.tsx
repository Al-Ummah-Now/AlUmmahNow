'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/hooks/useLanguage';
import { useMultiAccount } from '@/hooks/useMultiAccount';

export function StudioNoChannel({ locale }: { locale: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const { createChannel, creatingChannel, reloadChannels } = useMultiAccount();
  const [name, setName] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || creatingChannel) return;
    const created = await createChannel({ name: name.trim() });
    if (created) {
      await reloadChannels();
      router.push(`/${locale}/studio/${encodeURIComponent(created.id)}/dashboard`);
    }
  };

  return (
    <main id="main-content" className="mx-auto max-w-md px-4 py-16">
      <h1 className="mb-3 text-2xl font-bold text-foreground">{t.studio.noChannel.title}</h1>
      <p className="mb-6 text-muted-foreground">{t.studio.noChannel.body}</p>
      <form onSubmit={submit} className="space-y-3">
        <Label htmlFor="studio-channel-name">{t.studio.noChannel.nameLabel}</Label>
        <Input id="studio-channel-name" value={name} onChange={(event) => setName(event.target.value)} dir="auto" />
        <Button type="submit" disabled={!name.trim() || creatingChannel} data-testid="studio-create-channel">
          {t.studio.noChannel.create}
        </Button>
      </form>
    </main>
  );
}
