import Image from 'next/image';
import Link from 'next/link';

/** Original vector artwork exported directly from the supplied PDF. */
export function Logo() {
  return (
    <Link href="/" aria-label="MONZO, inicio" className="brand-logo">
      <Image src="/brand/logo/monzo-light.svg" alt="" width={1000} height={167} unoptimized />
    </Link>
  );
}
