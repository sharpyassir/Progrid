import { ConnectNav } from '@/components/connect/ui';

/** Every Connect page shares the product header and the section links. */
export default function ConnectLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <ConnectNav />
      {children}
    </div>
  );
}
