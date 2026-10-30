import type { Metadata } from 'next';

import { renderContent } from '@/lib/content';
import { pageMeta } from '@/lib/meta';

export const metadata: Metadata = pageMeta({
  title: 'Support',
  description: 'How to get help with Pleione: common fixes, bug reports and contact.',
  path: '/support/',
  card: 'support',
});

export default function Support() {
  return (
    <div className="wrap">
      <article className="prose" dangerouslySetInnerHTML={{ __html: renderContent('support') }} />
    </div>
  );
}
