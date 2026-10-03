import { legalIndexMetadata, renderLegalIndex } from '@/lib/page-routes';

export async function generateMetadata() { return legalIndexMetadata('ar'); }
export default async function Page() { return renderLegalIndex('ar'); }
