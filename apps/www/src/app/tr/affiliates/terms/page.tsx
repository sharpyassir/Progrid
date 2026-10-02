import { AffiliateTerms, affiliateTermsMetadata } from '@/components/affiliates';

export const generateMetadata = () => affiliateTermsMetadata('tr');
export default function Page() { return <AffiliateTerms lang="tr" />; }
