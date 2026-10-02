import { Home, pageMetadata } from '@/components/home';

export const generateMetadata = () => pageMetadata('ar');

export default function Page() {
  return <Home lang="ar" />;
}
