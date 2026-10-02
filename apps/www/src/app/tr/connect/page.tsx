import { ConnectPage, connectMetadata } from '@/components/connect';

export const generateMetadata = () => connectMetadata('tr');
export default function Page() { return <ConnectPage lang="tr" />; }
