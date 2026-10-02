import { ConnectPage, connectMetadata } from '@/components/connect';

export const generateMetadata = () => connectMetadata('en');
export default function Page() { return <ConnectPage lang="en" />; }
