'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Loading } from '@/components/managed';

/** The managed back office starts at the contracts list. */
export default function AdminManagedIndex() {
  const router = useRouter();
  useEffect(() => { router.replace('/admin/managed/contracts'); }, [router]);
  return <Loading />;
}
