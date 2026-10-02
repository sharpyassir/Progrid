import { ConnectPage, connectMetadata } from '@/components/connect';

export const generateMetadata = () => connectMetadata('ar');
export default function Page() { return <ConnectPage lang="ar" />; }
