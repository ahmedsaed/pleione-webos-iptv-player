import type { Metadata } from 'next';

import { renderContent } from '@/lib/content';
import { pageMeta } from '@/lib/meta';

export const metadata: Metadata = pageMeta({
  title: 'Terms of use',
  description: 'Pleione is a player: it ships no channels or content, and you are responsible for the sources you add.',
  path: '/terms/',
  card: 'terms',
});

export default function Terms() {
  return (
    <div className="wrap">
      <article className="prose" dangerouslySetInnerHTML={{ __html: renderContent('terms') }} />
    </div>
  );
}
