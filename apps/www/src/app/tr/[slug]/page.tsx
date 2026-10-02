import { pageMetadataFor, renderPage } from '@/lib/page-routes';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) { return pageMetadataFor('tr', (await params).slug); }
export default async function Page({ params }: { params: Promise<{ slug: string }> }) { return renderPage('tr', 'page', (await params).slug); }
