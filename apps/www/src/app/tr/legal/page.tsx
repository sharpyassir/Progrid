import { legalIndexMetadata, renderLegalIndex } from '@/lib/page-routes';

export async function generateMetadata() { return legalIndexMetadata('tr'); }
export default async function Page() { return renderLegalIndex('tr'); }
