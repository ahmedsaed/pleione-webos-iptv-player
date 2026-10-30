import type { Metadata } from 'next';

import { renderContent } from '@/lib/content';
import { pageMeta } from '@/lib/meta';

export const metadata: Metadata = pageMeta({
  title: 'Privacy policy',
  description: 'What Pleione keeps on your TV, what it sends and to whom, and how to delete it.',
  path: '/privacy/',
  card: 'privacy',
});

export default function Privacy() {
  return (
    <div className="wrap">
      <article className="prose" dangerouslySetInnerHTML={{ __html: renderContent('privacy') }} />
    </div>
  );
}
