import { pageMetadataFor, pageParams, renderPage } from '@/lib/page-routes';

export const dynamicParams = false;
export function generateStaticParams() { return pageParams('page'); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) { return pageMetadataFor('ar', (await params).slug); }
export default async function Page({ params }: { params: Promise<{ slug: string }> }) { return renderPage('ar', 'page', (await params).slug); }
