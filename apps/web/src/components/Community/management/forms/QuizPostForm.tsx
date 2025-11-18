'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Plus, X } from 'lucide-react';

export interface QuizFormData {
  question: string;
  options: Array<{ id: string; text: string }>;
  correctOptionId: string;
  explanation?: string;
}

interface QuizPostFormProps {
  data: QuizFormData;
  onChange: (data: QuizFormData) => void;
  locale: string;
  error?: string;
}

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
const MAX_OPTION_CHARS = 80;
const MAX_EXPLANATION_CHARS = 500;

export function QuizPostForm({ data, onChange, locale, error }: QuizPostFormProps) {
  const isRTL = locale === 'ar';

  const handleQuestionChange = (question: string) => {
    onChange({ ...data, question });
  };

  const handleOptionChange = (index: number, text: string) => {
    const newOptions = [...data.options];
    newOptions[index] = { ...newOptions[index], text };
    onChange({ ...data, options: newOptions });
  };

  const handleAddOption = () => {
    if (data.options.length < MAX_OPTIONS) {
      const newId = `option-${Date.now()}`;
      onChange({
        ...data,
        options: [...data.options, { id: newId, text: '' }]
      });
    }
  };

  const handleRemoveOption = (index: number) => {
    if (data.options.length > MIN_OPTIONS) {
      const removedId = data.options[index].id;
      const newOptions = data.options.filter((_, i) => i !== index);
      onChange({
        ...data,
        options: newOptions,
        correctOptionId: data.correctOptionId === removedId
          ? newOptions[0]?.id || ''
          : data.correctOptionId
      });
    }
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <Label htmlFor="quiz-question" className="text-sm md:text-base">
          {isRTL ? 'السؤال' : 'Question'}
        </Label>
        <Input
          id="quiz-question"
          value={data.question}
          onChange={(e) => handleQuestionChange(e.target.value)}
          placeholder={isRTL ? 'اطرح سؤال اختبار...' : 'Ask a quiz question...'}
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

        <RadioGroup
          value={data.correctOptionId}
          onValueChange={(value) => onChange({ ...data, correctOptionId: value })}
          className="mt-3 space-y-3"
        >
          {data.options.map((option, index) => (
            <Card key={option.id} className="p-3 md:p-4">
              <div className="flex gap-2 md:gap-3 items-start">
                <RadioGroupItem
                  value={option.id}
                  id={`option-${option.id}`}
                  className="mt-3 shrink-0"
                />

                <div className="flex-1">
                  <Label htmlFor={`option-${option.id}`} className="text-xs text-muted-foreground">
                    {isRTL ? 'إجابة صحيحة؟' : 'Correct answer?'}
                  </Label>
                  <Input
                    value={option.text}
                    onChange={(e) => handleOptionChange(index, e.target.value)}
                    placeholder={isRTL
                      ? `الخيار ${index + 1}`
                      : `Option ${index + 1}`
                    }
                    dir={isRTL ? 'rtl' : 'ltr'}
                    maxLength={MAX_OPTION_CHARS}
                    className="mt-1 text-sm md:text-base"
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
                    className="shrink-0 w-8 h-8 md:w-9 md:h-9 mt-6"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </RadioGroup>

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

      <div>
        <Label htmlFor="quiz-explanation" className="text-sm md:text-base">
          {isRTL ? 'التفسير (اختياري)' : 'Explanation (optional)'}
        </Label>
        <Textarea
          id="quiz-explanation"
          value={data.explanation || ''}
          onChange={(e) => onChange({ ...data, explanation: e.target.value })}
          placeholder={isRTL
            ? 'اشرح الإجابة الصحيحة...'
            : 'Explain the correct answer...'
          }
          dir={isRTL ? 'rtl' : 'ltr'}
          className="mt-2 min-h-[100px] text-sm md:text-base"
          maxLength={MAX_EXPLANATION_CHARS}
        />
        <p className="text-xs text-muted-foreground mt-1">
          {(data.explanation || '').length}/{MAX_EXPLANATION_CHARS}
        </p>
      </div>

      {error && (
        <p className="text-destructive text-xs md:text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
