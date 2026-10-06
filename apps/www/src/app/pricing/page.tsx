import { PricingPage, pricingMetadata } from '@/components/home';

export const generateMetadata = () => pricingMetadata('en');

export default function Page() {
  return <PricingPage lang="en" />;
}
