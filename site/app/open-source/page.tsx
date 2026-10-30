import type { Metadata } from 'next';

import { renderContent } from '@/lib/content';
import { pageMeta } from '@/lib/meta';

export const metadata: Metadata = pageMeta({
  title: 'Open source',
  description: 'Pleione is free software under the Apache-2.0 license, based on webOS IPTV Player by lennylxx.',
  path: '/open-source/',
  card: 'credits',
});

export default function OpenSource() {
  return (
    <div className="wrap">
      <article className="prose" dangerouslySetInnerHTML={{ __html: renderContent('open-source') }} />
    </div>
  );
}
