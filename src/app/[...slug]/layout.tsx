import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { AIAccessGate } from '@/components/ai/gate';

export default function Layout({ children }: LayoutProps<'/[...slug]'>) {
  return (
    <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
      {children}
      <AIAccessGate />
    </DocsLayout>
  );
}
