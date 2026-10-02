import { pageMetadataFor, renderPage } from '@/lib/page-routes';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) { return pageMetadataFor('en', (await params).slug, 'legal'); }
export default async function Page({ params }: { params: Promise<{ slug: string }> }) { return renderPage('en', 'legal', (await params).slug); }
