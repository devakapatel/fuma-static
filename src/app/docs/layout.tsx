import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { AISearch, AISearchPanel } from '@/components/ai/search';
import { AIHeaderTrigger } from '@/components/ai-header-trigger';

export default function Layout({ children }: LayoutProps<'/docs'>) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      {...baseOptions()}
      slots={{
        header: AIHeaderTrigger,
      }}
    >
      <AISearch>
        <AISearchPanel />
        {children}
      </AISearch>
    </DocsLayout>
  );
}
