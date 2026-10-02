import { Affiliates, affiliatesMetadata } from '@/components/affiliates';

export const generateMetadata = () => affiliatesMetadata('tr');
export default function Page() { return <Affiliates lang="tr" />; }
