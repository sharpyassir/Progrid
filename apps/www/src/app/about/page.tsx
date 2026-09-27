import { About, aboutMetadata } from '@/components/about';

export const metadata = aboutMetadata('en');
export default function Page() { return <About lang="en" />; }
