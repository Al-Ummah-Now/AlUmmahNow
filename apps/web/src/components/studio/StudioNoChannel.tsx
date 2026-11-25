'use client';

import { HelpLink } from '@/components/help/HelpLink';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/hooks/useLanguage';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useCreatorAccess } from '@/hooks/useCreatorAccess';
import { useCreatorTermsPrompt } from '@/components/legal/useCreatorTermsPrompt';

export function StudioNoChannel({ locale }: { locale: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const creator = useCreatorAccess();
  const { createChannel, creatingChannel, reloadChannels } = useMultiAccount();
  const [name, setName] = useState('');
  const terms = useCreatorTermsPrompt(() => create());

  const create = async () => {
    if (!name.trim() || creatingChannel) return;
    if (terms.askFirst(creator, undefined)) return;
    terms.clear();
    const created = await createChannel(
      { name: name.trim() },
      { onTermsRequired: () => terms.refused() },
    );
    if (created) {
      await reloadChannels();
      router.push(`/${locale}/studio/${encodeURIComponent(created.id)}/dashboard`);
    }
  };

  return (
    <main id="main-content" className="mx-auto max-w-md px-4 py-16">
      <h1 className="mb-3 text-2xl font-bold text-foreground">{t.studio.noChannel.title}</h1>
      <p className="mb-2 text-muted-foreground">{t.studio.noChannel.body}</p>
      <p className="mb-6"><HelpLink topic="identity" section="create-a-channel" /></p>
      <form onSubmit={(event: FormEvent) => { event.preventDefault(); void create(); }} className="space-y-3">
        <Label htmlFor="studio-channel-name">{t.studio.noChannel.nameLabel}</Label>
        <Input id="studio-channel-name" value={name} onChange={(event) => setName(event.target.value)} dir="auto" />
        <Button type="submit" disabled={!name.trim() || creatingChannel} data-testid="studio-create-channel">
          {t.studio.noChannel.create}
        </Button>
        {terms.needed && (
          <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-[var(--fanous-color-error-text)]" data-testid="studio-create-channel-terms">
            <span>{t.creator.termsRequired}</span>
            {terms.reviewLink('studio-create-channel-review-terms')}
          </p>
        )}
      </form>
      {terms.dialog}
    </main>
  );
}
