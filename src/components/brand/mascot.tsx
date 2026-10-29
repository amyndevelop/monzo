import Image from 'next/image';
export const reactions = [
  'welcome',
  'wink',
  'working',
  'phone',
  'love',
  'happy',
  'idea',
  'checklist',
  'thinking',
  'sleeping',
  'hearts',
  'surprised',
  'cool',
  'angry',
  'celebrating',
  'pointing',
  'growth',
  'support',
  'time',
  'sparkle',
] as const;
export type MascotReaction = (typeof reactions)[number];
export function Mascot({
  reaction = 'welcome',
  size = 320,
  priority = false,
  className,
  decorative = false,
}: {
  reaction?: MascotReaction;
  size?: number;
  priority?: boolean;
  className?: string;
  decorative?: boolean;
}) {
  return (
    <Image
      src={`/brand/mascot/${reaction}.webp`}
      alt={decorative ? '' : 'MONZO, nuestro asistente pulpo blanco y turquesa'}
      width={size}
      height={size}
      className={className}
      priority={priority}
    />
  );
}
