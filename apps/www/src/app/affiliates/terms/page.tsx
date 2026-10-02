import { AffiliateTerms, affiliateTermsMetadata } from '@/components/affiliates';

export const generateMetadata = () => affiliateTermsMetadata('en');
export default function Page() { return <AffiliateTerms lang="en" />; }
