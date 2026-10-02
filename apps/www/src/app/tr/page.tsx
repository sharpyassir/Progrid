import { Home, pageMetadata } from '@/components/home';

export const generateMetadata = () => pageMetadata('tr');

export default function Page() {
  return <Home lang="tr" />;
}
