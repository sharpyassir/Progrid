import { Home, pageMetadata } from '@/components/home';

export const generateMetadata = () => pageMetadata('en');

export default function Page() {
  return <Home lang="en" />;
}
