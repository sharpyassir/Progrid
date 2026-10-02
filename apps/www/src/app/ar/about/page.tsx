import { About, aboutMetadata } from '@/components/about';

export const generateMetadata = () => aboutMetadata('ar');
export default function Page() { return <About lang="ar" />; }
