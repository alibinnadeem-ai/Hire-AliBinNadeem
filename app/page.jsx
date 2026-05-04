import fs from 'fs';
import path from 'path';

export default function HomePage() {
  const legacyHtml = fs.readFileSync(path.join(process.cwd(), 'frontend', 'index.html'), 'utf8');
  const head = legacyHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
  const body = legacyHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || legacyHtml;
  const preservedHeadAssets = head
    .replace(/<meta[\s\S]*?>/gi, '')
    .replace(/<title[\s\S]*?<\/title>/gi, '');

  return (
    <div
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: `${preservedHeadAssets}${body}` }}
    />
  );
}
