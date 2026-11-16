'use client';

import Link from 'next/link';
import { LogOut, UserRound } from 'lucide-react';
import { useAuth } from './auth-context';
import { cn } from '@/lib/cn';
import { buttonVariants } from '@/components/ui/button';

export function AuthMenu({ className }: { className?: string }) {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return (
      <span
        aria-hidden
        className={cn('h-8 w-20 animate-pulse rounded-full bg-fd-muted', className)}
      />
    );
  }

  if (!user) {
    return (
      <Link
        href="/login"
        className={cn(
          buttonVariants({
            variant: 'secondary',
            size: 'sm',
            className: 'rounded-full',
          }),
          className,
        )}
      >
        Sign in
      </Link>
    );
  }

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium text-fd-muted-foreground">
        <UserRound className="size-3.5" />
        {user.username}
        {user.paid && <span className="text-fd-primary">· AI</span>}
      </span>
      <button
        type="button"
        onClick={() => void logout()}
        title="Log out"
        aria-label="Log out"
        className={cn(
          buttonVariants({
            variant: 'ghost',
            size: 'icon-sm',
            className: 'rounded-full text-fd-muted-foreground',
          }),
        )}
      >
        <LogOut />
      </button>
    </div>
  );
}
