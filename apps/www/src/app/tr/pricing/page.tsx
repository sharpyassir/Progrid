import { PricingPage, pricingMetadata } from '@/components/home';

export const generateMetadata = () => pricingMetadata('tr');

export default function Page() {
  return <PricingPage lang="tr" />;
}
