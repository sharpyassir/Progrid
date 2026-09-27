import { pageMetadataFor, pageParams, renderPage } from '@/lib/page-routes';

export const dynamicParams = false;
export function generateStaticParams() { return pageParams('page'); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) { return pageMetadataFor('en', (await params).slug); }
export default async function Page({ params }: { params: Promise<{ slug: string }> }) { return renderPage('en', 'page', (await params).slug); }
