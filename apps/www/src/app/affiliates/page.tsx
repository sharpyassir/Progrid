import { Affiliates, affiliatesMetadata } from '@/components/affiliates';

export const generateMetadata = () => affiliatesMetadata('en');
export default function Page() { return <Affiliates lang="en" />; }
