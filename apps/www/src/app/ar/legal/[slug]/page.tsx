import { pageMetadataFor, renderPage } from '@/lib/page-routes';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) { return pageMetadataFor('ar', (await params).slug, 'legal'); }
export default async function Page({ params }: { params: Promise<{ slug: string }> }) { return renderPage('ar', 'legal', (await params).slug); }
