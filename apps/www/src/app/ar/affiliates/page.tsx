import { Affiliates, affiliatesMetadata } from '@/components/affiliates';

export const generateMetadata = () => affiliatesMetadata('ar');
export default function Page() { return <Affiliates lang="ar" />; }
