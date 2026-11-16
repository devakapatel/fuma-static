'use client';
import SearchDialog from '@/components/search';
import { AuthProvider } from '@/components/auth/auth-context';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { type ReactNode } from 'react';

export function Provider({ children }: { children: ReactNode }) {
  return (
    <RootProvider search={{ SearchDialog }}>
      <AuthProvider>{children}</AuthProvider>
    </RootProvider>
  );
}
