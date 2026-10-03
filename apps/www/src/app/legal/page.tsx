import { legalIndexMetadata, renderLegalIndex } from '@/lib/page-routes';

export async function generateMetadata() { return legalIndexMetadata('en'); }
export default async function Page() { return renderLegalIndex('en'); }
