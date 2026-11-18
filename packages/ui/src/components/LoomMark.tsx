import { Icon } from "@astryxdesign/core/Icon";
import { useId, type SVGProps } from "react";

// The ring is an ellipse 14.6 by 3.5 about the planet's center, tilted 22 degrees up to the right.
// Before the tilt, its front half runs below the center.
const TILT = "rotate(-22 16 16)";
const FRONT = "M1.4 16A14.6 3.5 0 0 0 30.6 16";

/** The mark's artwork. Icon sets its size and color and hides it from assistive technology. */
const LoomGlyph = (props: Omit<SVGProps<SVGSVGElement>, "ref">) => {
  const id = useId();
  const fade = `${id}fade`;
  const behind = `${id}behind`;
  const seam = `${id}seam`;
  return (
    <svg viewBox="0 0 32 32" {...props}>
      <defs>
        {/* Across the ring: a light gray at the back, the full ink at the front. */}
        <linearGradient
          id={fade}
          gradientUnits="userSpaceOnUse"
          x1="16"
          y1="12.5"
          x2="16"
          y2="19.5"
        >
          <stop offset="0.38" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="0.62" stopColor="currentColor" />
        </linearGradient>
        {/* The ring shows except behind the planet and a seam around it, and in front of it. */}
        <mask id={behind} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
          <rect width="32" height="32" fill="white" />
          <circle cx="16" cy="16" r="7.8" fill="black" stroke="black" strokeWidth="2.3" />
          <path d={FRONT} transform={TILT} fill="none" stroke="white" strokeWidth="2.7" />
        </mask>
        {/* The planet gives way to the front of the ring and a seam on either side of it. */}
        <mask id={seam} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
          <rect width="32" height="32" fill="white" />
          <path d={FRONT} transform={TILT} fill="none" stroke="black" strokeWidth="4.6" />
        </mask>
      </defs>
      <g mask={`url(#${behind})`}>
        <g transform={TILT}>
          <ellipse
            cx="16"
            cy="16"
            rx="14.6"
            ry="3.5"
            fill="none"
            stroke={`url(#${fade})`}
            strokeWidth="2.3"
          />
        </g>
      </g>
      <g mask={`url(#${seam})`}>
        <circle cx="16" cy="16" r="7.8" fill="currentColor" />
      </g>
    </svg>
  );
};

/**
 * Davloom's mark: a planet with a ring around it, tilted up to the right. The ring fades from a
 * light gray behind the planet to the full ink in front of it, where a seam parts it from the
 * planet. It is drawn in the accent, which Icon sets as its color, so the mark inverts with the
 * mode. It is decorative; the product name beside it names the link.
 */
export const LoomMark = () => <Icon icon={LoomGlyph} size="lg" color="accent" />;
