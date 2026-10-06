import { PricingPage, pricingMetadata } from '@/components/home';

export const generateMetadata = () => pricingMetadata('ar');

export default function Page() {
  return <PricingPage lang="ar" />;
}
