'use client';

/**
 * OrgLogo — renders the current Organization's short name (or custom logo
 * when available) in a consistent badge. Used anywhere the UI needs to
 * reinforce which company's app the user is inside.
 *
 * Keep this component purely presentational; state + branding lookup happen
 * in useOrg(). Do not add business logic here. See ARCHITECTURE.md.
 */

import { useOrg } from '@/contexts/OrgContext';

interface OrgLogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<OrgLogoProps['size']>, string> = {
  sm: 'w-6 h-6 text-xs',
  md: 'w-10 h-10 text-base',
  lg: 'w-20 h-20 text-3xl',
};

export default function OrgLogo({ size = 'md', className = '' }: OrgLogoProps) {
  const { current } = useOrg();
  const initial = current.shortName.charAt(0);
  return (
    <div
      className={`inline-flex items-center justify-center rounded-full font-bold text-white ${SIZE_CLASSES[size]} ${className}`}
      style={{
        backgroundImage: `linear-gradient(135deg, ${current.primaryColor}, ${current.accentColor})`,
      }}
      title={current.name}
    >
      {initial}
    </div>
  );
}
