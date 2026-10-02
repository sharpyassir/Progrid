import { pageMetadataFor, renderPage } from '@/lib/page-routes';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) { return pageMetadataFor('tr', (await params).slug, 'legal'); }
export default async function Page({ params }: { params: Promise<{ slug: string }> }) { return renderPage('tr', 'legal', (await params).slug); }
