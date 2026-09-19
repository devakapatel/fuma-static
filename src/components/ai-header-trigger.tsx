'use client';

import { AISearch, AISearchTrigger } from '@/components/ai/search';
import { MessageCircleIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { buttonVariants } from '@/components/ui/button';

export function AIHeaderTrigger() {
  return (
    <AISearch>
      <AISearchTrigger
        position="float"
        className={cn(
          buttonVariants({
            variant: 'secondary',
            className: 'text-fd-muted-foreground rounded-2xl',
          }),
        )}
      >
        <MessageCircleIcon className="size-4.5" />
        Ask AI
      </AISearchTrigger>
    </AISearch>
  );
}