import { pageMetadataFor, pageParams, renderPage } from '@/lib/page-routes';

export const dynamicParams = false;
export function generateStaticParams() { return pageParams('legal'); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) { return pageMetadataFor('tr', (await params).slug); }
export default async function Page({ params }: { params: Promise<{ slug: string }> }) { return renderPage('tr', 'legal', (await params).slug); }
