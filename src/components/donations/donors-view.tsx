'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Heart, Loader2, RefreshCw, UserRound } from 'lucide-react';
import { apiUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatMoney } from '@/lib/format';
import { buttonVariants } from '@/components/ui/button';

interface Donor {
  id: string;
  email: string | null;
  amount: number;
  paidAt: string | null;
  anonymous: boolean;
}

interface DonorsResponse {
  donors: Donor[];
  donationCount: number;
  totalAmount: number;
}

export function DonorsView() {
  const [data, setData] = useState<DonorsResponse | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    fetch(apiUrl('/api/donors'), { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('donors');
        return (await response.json()) as DonorsResponse;
      })
      .then((payload) => {
        if (!cancelled) {
          setData(payload);
          setError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return (
    <div className="not-prose w-full">
      <div className="text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
          <Heart className="size-6" />
        </span>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Donors</h1>
        <p className="mx-auto mt-2 max-w-md text-balance text-fd-muted-foreground">
          The people who keep T9 running. Donations pay for hosting and new
          notes.
        </p>
      </div>

      {error ? (
        <div className="mt-10 rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm text-fd-muted-foreground">
            Could not load the donor list.
          </p>
          <button
            type="button"
            onClick={retry}
            className={cn(
              buttonVariants({
                variant: 'secondary',
                className: 'mt-4 gap-2 rounded-full',
              }),
            )}
          >
            <RefreshCw className="size-4" />
            Try again
          </button>
        </div>
      ) : !data ? (
        <div className="mt-10 flex items-center justify-center gap-2 py-16 text-sm text-fd-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading donors…
        </div>
      ) : (
        <>
          <div className="mt-10 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border p-5 text-center">
              <p className="text-xs uppercase tracking-wide text-fd-muted-foreground">
                Raised
              </p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">
                {formatMoney(data.totalAmount)}
              </p>
            </div>
            <div className="rounded-xl border p-5 text-center">
              <p className="text-xs uppercase tracking-wide text-fd-muted-foreground">
                Donations
              </p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">
                {data.donationCount}
              </p>
            </div>
          </div>

          {data.donors.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed p-10 text-center">
              <Heart className="mx-auto size-6 text-fd-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No donations yet</p>
              <p className="mt-1 text-sm text-fd-muted-foreground">
                Be the first to support the project.
              </p>
            </div>
          ) : (
            <ul className="mt-6 divide-y rounded-xl border">
              {data.donors.map((donor) => (
                <li
                  key={donor.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    {donor.anonymous ? (
                      <>
                        <UserRound className="size-4 shrink-0 text-fd-muted-foreground" />
                        <span className="text-fd-muted-foreground">
                          Anonymous
                        </span>
                      </>
                    ) : (
                      <span className="truncate">{donor.email}</span>
                    )}
                  </span>
                  <span className="flex items-center gap-3 text-sm">
                    <span className="font-medium">
                      {formatMoney(donor.amount)}
                    </span>
                    {donor.paidAt && (
                      <span className="text-xs text-fd-muted-foreground">
                        {formatDate(donor.paidAt)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 text-center text-xs text-fd-muted-foreground">
            Donors are listed by the email they signed in with. Donations marked
            anonymous show only the amount.
          </p>

          <div className="mt-8 flex justify-center">
            <Link
              href="/account?donate=1"
              className={cn(
                buttonVariants({
                  variant: 'primary',
                  className: 'gap-2 rounded-full',
                }),
              )}
            >
              <Heart className="size-4" />
              Donate us
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
