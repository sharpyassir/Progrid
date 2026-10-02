import { redirect } from 'next/navigation';
import { getSite } from '@/lib/site';

/** The affiliate portal lives in the console of this domain (it needs a signed in account). */
export default async function Page() { redirect(`${(await getSite()).urls.console}/affiliates/portal`); }
