'use client';

import type { PostMedia, SlidePosition } from '@al-ummah/shared-types';
import { POST_LIMITS } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/hooks/useLanguage';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { PostImageField } from './PostImageField';

export interface CardFormData {
  id: string;
  image: PostMedia | null;
  heading: string;
  body: string;
  position: SlidePosition;
}

export interface CardsFormData {
  title: string;
  cards: CardFormData[];
}

let seq = 0;
export const newCard = (): CardFormData => ({ id: `c${Date.now().toString(36)}${(seq++).toString(36)}`, image: null, heading: '', body: '', position: 'bottom' });
export const emptyCards = (): CardsFormData => ({ title: '', cards: [newCard()] });

interface CardsPostFormProps {
  channelId: string;
  data: CardsFormData;
  onChange: (data: CardsFormData) => void;
  postLocale: 'en' | 'ar';
}

const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

/** A cards post: a title and up to 40 cards, each an image with alt text and optional overlay text. */
export function CardsPostForm({ channelId, data, onChange, postLocale }: CardsPostFormProps) {
  const { t } = useLanguage();
  const dir = postLocale === 'ar' ? 'rtl' : 'ltr';
  const setCard = (i: number, card: CardFormData) => onChange({ ...data, cards: data.cards.map((c, j) => (j === i ? card : c)) });
  const move = (i: number, by: -1 | 1) => {
    const cards = [...data.cards];
    const [c] = cards.splice(i, 1);
    cards.splice(i + by, 0, c);
    onChange({ ...data, cards });
  };
  const positions: { value: SlidePosition; label: string }[] = [
    { value: 'top', label: t.community.positionTop },
    { value: 'middle', label: t.community.positionMiddle },
    { value: 'bottom', label: t.community.positionBottom },
  ];
  return (
    <div className="space-y-4" data-testid="cards-post-form">
      <div className="space-y-2">
        <Label htmlFor="cards-title" className="text-sm md:text-base">{t.community.title} *</Label>
        <Input id="cards-title" dir={dir} lang={postLocale} value={data.title} maxLength={POST_LIMITS.title} required aria-required onChange={(e) => onChange({ ...data, title: e.target.value })} />
      </div>
      <p className="text-xs md:text-sm text-muted-foreground">{fill(t.community.cardsLimit, { max: POST_LIMITS.slides })}</p>
      <ol className="space-y-4">
        {data.cards.map((card, i) => {
          const name = fill(t.community.cardNumber, { n: i + 1 });
          return (
            <li key={card.id}>
              <Card className="p-4 space-y-3" role="group" aria-label={name} data-testid="cards-post-card">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-sm md:text-base">{name}</h3>
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="icon" className="w-11 h-11" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${t.community.moveCardUp}: ${name}`}>
                      <ArrowUp className="w-4 h-4" aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="w-11 h-11" disabled={i === data.cards.length - 1} onClick={() => move(i, 1)} aria-label={`${t.community.moveCardDown}: ${name}`}>
                      <ArrowDown className="w-4 h-4" aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="w-11 h-11" disabled={data.cards.length === 1} onClick={() => onChange({ ...data, cards: data.cards.filter((_, j) => j !== i) })} aria-label={`${t.community.removeCard}: ${name}`}>
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <PostImageField channelId={channelId} label={`${t.community.cardImage} *`} value={card.image} altRequired onChange={(image) => setCard(i, { ...card, image })} />
                <div className="space-y-1">
                  <Label htmlFor={`${card.id}-heading`} className="text-xs md:text-sm">{t.community.cardHeading}</Label>
                  <Input id={`${card.id}-heading`} dir={dir} lang={postLocale} value={card.heading} maxLength={POST_LIMITS.slideHeading} onChange={(e) => setCard(i, { ...card, heading: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${card.id}-body`} className="text-xs md:text-sm">{t.community.cardText}</Label>
                  <Textarea id={`${card.id}-body`} dir={dir} lang={postLocale} value={card.body} maxLength={POST_LIMITS.slideBody} className="min-h-[72px]" onChange={(e) => setCard(i, { ...card, body: e.target.value })} />
                </div>
                <fieldset className="space-y-1">
                  <legend className="text-xs md:text-sm font-medium">{t.community.cardPosition}</legend>
                  <div className="flex gap-4">
                    {positions.map((p) => (
                      <label key={p.value} className="flex items-center gap-2 text-sm min-h-[44px]">
                        <input type="radio" name={`${card.id}-position`} value={p.value} checked={card.position === p.value} onChange={() => setCard(i, { ...card, position: p.value })} />
                        {p.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </Card>
            </li>
          );
        })}
      </ol>
      <Button type="button" variant="outline" disabled={data.cards.length >= POST_LIMITS.slides} onClick={() => onChange({ ...data, cards: [...data.cards, newCard()] })}>
        <Plus className="w-4 h-4" aria-hidden="true" />
        <span className="ms-1">{t.community.addCard}</span>
      </Button>
    </div>
  );
}
