'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, X } from 'lucide-react';

export interface PollFormData {
  question: string;
  options: Array<{ text: string }>;
  multipleChoice: boolean;
  votingEndsAt?: string;
}

interface PollPostFormProps {
  data: PollFormData;
  onChange: (data: PollFormData) => void;
  locale: string;
  error?: string;
}

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 5;
const MAX_OPTION_CHARS = 65;

export function PollPostForm({ data, onChange, locale, error }: PollPostFormProps) {
  const isRTL = locale === 'ar';

  const handleQuestionChange = (question: string) => {
    onChange({ ...data, question });
  };

  const handleOptionChange = (index: number, text: string) => {
    const newOptions = [...data.options];
    newOptions[index] = { text };
    onChange({ ...data, options: newOptions });
  };

  const handleAddOption = () => {
    if (data.options.length < MAX_OPTIONS) {
      onChange({ ...data, options: [...data.options, { text: '' }] });
    }
  };

  const handleRemoveOption = (index: number) => {
    if (data.options.length > MIN_OPTIONS) {
      const newOptions = data.options.filter((_, i) => i !== index);
      onChange({ ...data, options: newOptions });
    }
  };

  const handleDurationChange = (days: string) => {
    const now = new Date();
    now.setDate(now.getDate() + parseInt(days));
    onChange({ ...data, votingEndsAt: now.toISOString() });
  };

  const getDaysUntilEnd = () => {
    if (!data.votingEndsAt) return '7';
    const end = new Date(data.votingEndsAt);
    const now = new Date();
    const days = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return String(Math.max(1, Math.min(7, days)));
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <Label htmlFor="poll-question" className="text-sm md:text-base">
          {isRTL ? 'السؤال' : 'Question'}
        </Label>
        <Input
          id="poll-question"
          value={data.question}
          onChange={(e) => handleQuestionChange(e.target.value)}
          placeholder={isRTL ? 'اسأل جمهورك سؤالاً...' : 'Ask your audience a question...'}
          dir={isRTL ? 'rtl' : 'ltr'}
          className="mt-2 text-sm md:text-base"
        />
      </div>

      <div>
        <Label className="text-sm md:text-base">
          {isRTL ? 'الخيارات' : 'Options'}
          <span className="text-muted-foreground ml-2 rtl:mr-2 rtl:ml-0">
            ({data.options.length}/{MAX_OPTIONS})
          </span>
        </Label>

        <div className="mt-3 space-y-3">
          {data.options.map((option, index) => (
            <Card key={index} className="p-3 md:p-4">
              <div className="flex gap-2 md:gap-3 items-start">
                <div className="flex-1">
                  <Input
                    value={option.text}
                    onChange={(e) => handleOptionChange(index, e.target.value)}
                    placeholder={isRTL
                      ? `الخيار ${index + 1}`
                      : `Option ${index + 1}`
                    }
                    dir={isRTL ? 'rtl' : 'ltr'}
                    maxLength={MAX_OPTION_CHARS}
                    className="text-sm md:text-base"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {option.text.length}/{MAX_OPTION_CHARS}
                  </p>
                </div>

                {data.options.length > MIN_OPTIONS && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveOption(index)}
                    className="shrink-0 w-8 h-8 md:w-9 md:h-9 mt-1"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>

        {data.options.length < MAX_OPTIONS && (
          <Button
            type="button"
            variant="outline"
            onClick={handleAddOption}
            className="mt-3 w-full sm:w-auto"
          >
            <Plus className="w-4 h-4 mr-2 rtl:ml-2 rtl:mr-0" />
            {isRTL ? 'إضافة خيار' : 'Add Option'}
          </Button>
        )}
      </div>

      <div className="
        grid
        grid-cols-1       /* Mobile: stack */
        sm:grid-cols-2    /* Tablet: side by side */
        gap-4
      ">
        <div>
          <Label htmlFor="poll-duration" className="text-sm md:text-base">
            {isRTL ? 'مدة التصويت' : 'Poll Duration'}
          </Label>
          <Select value={getDaysUntilEnd()} onValueChange={handleDurationChange}>
            <SelectTrigger id="poll-duration" className="mt-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">
                {isRTL ? 'يوم واحد' : '1 day'}
              </SelectItem>
              <SelectItem value="3">
                {isRTL ? '٣ أيام' : '3 days'}
              </SelectItem>
              <SelectItem value="7">
                {isRTL ? '٧ أيام' : '7 days'}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <p className="text-destructive text-xs md:text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
