import { About, aboutMetadata } from '@/components/about';

export const generateMetadata = () => aboutMetadata('en');
export default function Page() { return <About lang="en" />; }
