import { About, aboutMetadata } from '@/components/about';

export const generateMetadata = () => aboutMetadata('tr');
export default function Page() { return <About lang="tr" />; }
