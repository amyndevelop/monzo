import Link from 'next/link';
import { Mascot } from '@/components/brand/mascot';
import { Button } from '@/components/ui/button';
export default function NotFound() {
  return (
    <main id="main" className="not-found">
      <Mascot reaction="thinking" size={210} />
      <p className="eyebrow">404 · NOS FUIMOS UN POQUITO LEJOS</p>
      <h1>Esta conversación empieza en otro lugar.</h1>
      <p>No encontramos la página que buscás.</p>
      <Button asChild>
        <Link href="/">Volver a MONZO</Link>
      </Button>
    </main>
  );
}
