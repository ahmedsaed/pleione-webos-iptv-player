import type { Metadata } from 'next';

import { renderContent } from '@/lib/content';
import { pageMeta } from '@/lib/meta';

export const metadata: Metadata = pageMeta({
  title: 'Setup guide',
  description: 'Install Pleione on an LG TV, add an M3U playlist or an Xtream account, or set it up from your phone.',
  path: '/setup/',
  card: 'setup',
});

export default function Setup() {
  return (
    <div className="wrap">
      <article className="prose" dangerouslySetInnerHTML={{ __html: renderContent('setup') }} />
    </div>
  );
}
