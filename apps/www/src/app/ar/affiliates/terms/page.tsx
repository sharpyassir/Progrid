import { AffiliateTerms, affiliateTermsMetadata } from '@/components/affiliates';

export const generateMetadata = () => affiliateTermsMetadata('ar');
export default function Page() { return <AffiliateTerms lang="ar" />; }
