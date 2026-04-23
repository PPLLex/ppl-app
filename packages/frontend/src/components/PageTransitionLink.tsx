'use client';

/**
 * PageTransitionLink — drop-in replacement for `next/link` that wraps
 * client-side navigation in `document.startViewTransition()` so every
 * page change crossfades instead of hard-cutting.
 *
 * Cooperates with the global `.ppl-page-root` view-transition-name rule
 * in globals.css: pages fade-swap using the ::view-transition-* animations.
 * On browsers without View Transitions support, falls through to the
 * native Next.js client-side push (no behavior change).
 *
 * Respects all the standard "don't intercept" cases: external links,
 * new-tab modifier clicks (cmd / ctrl / shift / alt), middle clicks,
 * preventDefault. Lets the browser handle those naturally.
 *
 * Usage:
 *   import Link from '@/components/PageTransitionLink';
 *   <Link href="/admin/members">Members</Link>
 */

import NextLink, { LinkProps as NextLinkProps } from 'next/link';
import { useRouter } from 'next/navigation';
import { forwardRef, MouseEvent, AnchorHTMLAttributes, ReactNode } from 'react';

type PageTransitionLinkProps = Omit<NextLinkProps, 'href'> &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof NextLinkProps> & {
    href: string | NextLinkProps['href'];
    children?: ReactNode;
  };

const PageTransitionLink = forwardRef<HTMLAnchorElement, PageTransitionLinkProps>(
  function PageTransitionLink(props, ref) {
    const { href, onClick, target, ...rest } = props;
    const router = useRouter();

    const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
      // Standard "don't intercept" escape hatches.
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey ||
        target === '_blank'
      ) {
        onClick?.(e);
        return;
      }

      // Only intercept app-internal string paths. Object-style hrefs
      // (rare) fall through to Next's native handling.
      const resolvedHref = typeof href === 'string' ? href : null;
      if (!resolvedHref || !resolvedHref.startsWith('/')) {
        onClick?.(e);
        return;
      }

      // Progressive enhancement — only wrap in a View Transition when
      // the browser supports the API. Older Safari/Firefox fall through.
      const doc =
        typeof document !== 'undefined'
          ? (document as Document & {
              startViewTransition?: (cb: () => void) => void;
            })
          : null;

      if (doc?.startViewTransition) {
        e.preventDefault();
        doc.startViewTransition(() => {
          router.push(resolvedHref);
        });
      }

      onClick?.(e);
    };

    return (
      <NextLink
        {...rest}
        href={href}
        target={target}
        onClick={handleClick}
        ref={ref}
      />
    );
  }
);

export default PageTransitionLink;
