import type { Metadata } from 'next';
import { DonorsView } from '@/components/donations/donors-view';

export const metadata: Metadata = {
  title: 'Donors',
  description: 'People who support T9 through donations.',
};

export default function DonorsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-20">
      <DonorsView />
    </main>
  );
}
