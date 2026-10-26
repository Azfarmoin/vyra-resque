// Original VYRA illustrations. All SVG, themed from the palette, decorative unless `title` is given.
// Motion classes (.pin-pulse .boat-bob .wave-drift) are switched off for prefers-reduced-motion.

type Props = { className?: string; title?: string }

const a11y = (title?: string) => (title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const })

/** Hero: a flooded street, a rooftop calling for help, and a rescue boat on its way. */
export function RescueScene({ className, title }: Props) {
  return (
    <svg viewBox="0 0 640 560" className={className} {...a11y(title)}>
      <defs>
        <clipPath id="sceneClip"><rect width="640" height="560" rx="56" /></clipPath>
        <linearGradient id="skyWash" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FBE3D3" /><stop offset=".62" stopColor="#FBF1E4" />
        </linearGradient>
      </defs>
      <g clipPath="url(#sceneClip)">
      <rect width="640" height="560" fill="url(#skyWash)" />
      {/* sun and sky */}
      <circle cx="478" cy="150" r="118" fill="none" stroke="#F47755" strokeOpacity=".22" strokeWidth="2" />
      <circle cx="478" cy="150" r="92" fill="#F47755" />
      <circle cx="478" cy="150" r="92" fill="url(#sunShade)" />
      <path d="M60 128c8-34 44-34 56-12 16-20 52-14 58 12-28 14-70 12-114 0Z" fill="#FFFEFB" />
      <path d="M318 78c6-24 32-24 42-8 12-12 38-8 42 10-20 10-52 8-84-2Z" fill="#FFFEFB" opacity=".9" />
      <defs>
        <radialGradient id="sunShade" cx=".3" cy=".25" r=".9">
          <stop offset="0" stopColor="#fff" stopOpacity=".35" />
          <stop offset=".6" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* hills */}
      <path d="M0 330C80 270 150 290 230 310s150-50 240-30c70 16 130 20 170 0v140H0Z" fill="#D5DCE1" />
      <path d="M0 372c90-42 170-22 260-7s170-35 260-20c50 9 90 5 120-5v100H0Z" fill="#B2BEC8" />

      {/* back water */}
      <path d="M0 396c60-10 110 10 170 0s110 10 170 0 110 10 170 0 100 5 130-3v167H0Z" fill="#4B6073" />

      {/* house A (rooftop with people) */}
      <rect x="82" y="346" width="100" height="84" rx="8" fill="#F6F0E7" />
      <path d="M60 350 132 290l72 60Z" fill="#182B3A" />
      <rect x="116" y="372" width="30" height="40" rx="6" fill="#E9B94D" />
      <rect x="92" y="364" width="16" height="16" rx="4" fill="#B2BEC8" />
      {/* people on the roof */}
      <g>
        <circle cx="120" cy="276" r="7" fill="#F6F0E7" />
        <path d="M112 306c0-12 3-20 8-20s8 8 8 20Z" fill="#F47755" />
        <circle cx="146" cy="272" r="7" fill="#F6F0E7" />
        <path d="M138 303c0-12 3-20 8-20s8 8 8 20Z" fill="#E9B94D" />
        <path d="M153 286c8-8 10-16 8-24" stroke="#F6F0E7" strokeWidth="4" strokeLinecap="round" fill="none" />
      </g>
      {/* help pin */}
      <ellipse cx="133" cy="262" rx="22" ry="7" fill="none" stroke="#DF776E" strokeWidth="3" className="pin-pulse" />
      <path d="M133 262s-26-22-26-44a26 26 0 1 1 52 0c0 22-26 44-26 44Z" fill="#DF776E" stroke="#182B3A" strokeWidth="3" />
      <rect x="130" y="204" width="6" height="20" rx="3" fill="#182B3A" />
      <circle cx="133" cy="232" r="3.600" fill="#182B3A" />

      {/* house B */}
      <rect x="440" y="352" width="92" height="72" rx="8" fill="#EBE1D2" />
      <path d="M422 358l64-52 64 52Z" fill="#34495B" />
      <rect x="512" y="318" width="14" height="26" rx="3" fill="#34495B" />
      <rect x="470" y="378" width="28" height="34" rx="6" fill="#F47755" />

      {/* mid water */}
      <g className="wave-drift">
        <path d="M-40 434c70-14 120 10 190-2s120 12 190 0 130 12 200 0 120 8 160-4v136H-40Z" fill="#34495B" />
      </g>

      {/* route from boat to pin */}
      <path d="M318 410C262 372 196 342 146 270" fill="none" stroke="#182B3A" strokeOpacity=".45" strokeWidth="3" strokeDasharray="2 9" strokeLinecap="round" />

      {/* rescue boat */}
      <g transform="translate(300 392)"><g className="boat-bob">
        <path d="M40 8V-14" stroke="#182B3A" strokeWidth="4" strokeLinecap="round" />
        <path d="M42-14l30 10-30 10Z" fill="#E9B94D" />
        <path d="M0 40h196l-26 40H28Z" fill="#182B3A" />
        <path d="M10 48h176" stroke="#F6F0E7" strokeOpacity=".5" strokeWidth="3" strokeLinecap="round" />
        <path d="M52 40V14a10 10 0 0 1 10-10h50a10 10 0 0 1 10 10v26Z" fill="#F47755" />
        <circle cx="76" cy="22" r="7" fill="#F6F0E7" />
        <circle cx="100" cy="22" r="7" fill="#F6F0E7" />
        <circle cx="146" cy="14" r="8" fill="#F6F0E7" />
        <path d="M136 40c0-12 4-18 10-18s10 6 10 18Z" fill="#E9B94D" />
        <circle cx="170" cy="18" r="8" fill="#F6F0E7" />
        <path d="M160 40c0-12 4-18 10-18s10 6 10 18Z" fill="#43866F" />
        <circle cx="24" cy="56" r="11" fill="none" stroke="#F47755" strokeWidth="7" />
        <path d="M24 45v6m0 10v6m-11-11h6m10 0h6" stroke="#F6F0E7" strokeWidth="3.500" />
      </g></g>

      {/* foreground water and shimmer */}
      <path d="M0 494c80-14 150 10 230-2s150 12 230 0c70-10 130 6 180-4v72H0Z" fill="#182B3A" />
      <path d="M60 520c26-8 50-8 76 0M300 532c30-8 60-8 90 0M480 516c24-6 48-6 72 0" stroke="#F6F0E7" strokeOpacity=".22" strokeWidth="3" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  )
}

/** Auth / quiet moments: a beacon on a rock, rays reaching across the water. */
export function BeaconScene({ className, title }: Props) {
  return (
    <svg viewBox="0 0 420 460" className={className} {...a11y(title)}>
      <circle cx="210" cy="150" r="130" fill="#F47755" fillOpacity=".14" />
      <path d="M210 128 410 60v136L210 150Z" fill="#E9B94D" fillOpacity=".32" />
      <path d="M210 128 10 60v136L210 150Z" fill="#E9B94D" fillOpacity=".32" />
      {/* tower */}
      <path d="M176 400 190 190h60l14 210Z" fill="#FFFEFB" />
      <path d="M184 290h72l-3 36h-66ZM190 210h60l-2 34h-56Z" fill="#F47755" />
      <rect x="182" y="330" width="76" height="34" fill="#F47755" opacity="0" />
      <path d="M168 190h104l-10-22H178Z" fill="#182B3A" />
      <rect x="190" y="124" width="60" height="46" rx="10" fill="#E9B94D" />
      <rect x="200" y="134" width="40" height="26" rx="6" fill="#FFFEFB" opacity=".75" />
      <path d="M186 124l34-34 34 34Z" fill="#182B3A" />
      <circle cx="220" cy="86" r="6" fill="#F47755" />
      {/* rock and sea */}
      <path d="M90 420c20-40 60-48 90-42l60 0c40-6 80 4 100 42v40H90Z" fill="#34495B" />
      <g className="wave-drift">
        <path d="M-30 402c60-14 110 10 170-2s110 12 170 0 120 10 170-2 80 6 110-2v90H-30Z" fill="#4B6073" opacity=".9" />
      </g>
      <path d="M0 436c70-12 120 10 190-2s130 12 230-2v30H0Z" fill="#182B3A" />
      <path d="M40 300c10-8 22-8 32 0M330 250c10-8 22-8 32 0M70 220c8-6 16-6 24 0" stroke="#182B3A" strokeOpacity=".5" strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  )
}

/** Welcoming, community: three people around a shared lifebuoy. */
export function CommunityScene({ className, title }: Props) {
  return (
    <svg viewBox="0 0 420 380" className={className} {...a11y(title)}>
      <circle cx="210" cy="190" r="150" fill="#E9B94D" fillOpacity=".28" />
      <circle cx="210" cy="206" r="62" fill="none" stroke="#F47755" strokeWidth="26" />
      <path d="M210 144v26m0 72v26m-62-62h26m72 0h26" stroke="#FFFEFB" strokeWidth="14" />
      <g>
        <circle cx="96" cy="130" r="26" fill="#EBE1D2" /><path d="M54 270c0-52 18-86 42-86s42 34 42 86Z" fill="#43866F" />
        <circle cx="324" cy="130" r="26" fill="#EBE1D2" /><path d="M282 270c0-52 18-86 42-86s42 34 42 86Z" fill="#DF776E" />
        <circle cx="210" cy="82" r="26" fill="#F6F0E7" /><path d="M168 150c0-40 18-62 42-62s42 22 42 62Z" fill="#182B3A" />
      </g>
      <path d="M0 330c60-12 110 8 170-2s110 10 170 0 60-4 80-4v56H0Z" fill="#34495B" />
    </svg>
  )
}

/** Empty states: an open supply crate with a lifebuoy. */
export function EmptyCrate({ className, title }: Props) {
  return (
    <svg viewBox="0 0 200 160" className={className} {...a11y(title)}>
      <ellipse cx="100" cy="140" rx="70" ry="9" fill="#182B3A" fillOpacity=".12" />
      <path d="M40 66l60-26 60 26v56l-60 20-60-20V66Z" fill="#EBE1D2" />
      <path d="M40 66l60 22 60-22" fill="none" stroke="#C2AE91" strokeWidth="3" strokeLinejoin="round" />
      <path d="M100 88v54" stroke="#C2AE91" strokeWidth="3" />
      <path d="M40 66l-10-18 56-22 14 14Zm120 0 10-18-56-22-14 14Z" fill="#DCCDB7" />
      <circle cx="100" cy="62" r="22" fill="none" stroke="#F47755" strokeWidth="9" />
      <path d="M100 48v7m0 14v7m-14-14h7m14 0h7" stroke="#FFFEFB" strokeWidth="4" />
    </svg>
  )
}

/** Public-status "journey" illustration helper: a small map sketch with a pin. */
export function MapSketch({ className, title }: Props) {
  return (
    <svg viewBox="0 0 320 200" className={className} {...a11y(title)}>
      <rect width="320" height="200" rx="24" fill="#EBE1D2" />
      <path d="M-10 150C60 110 110 140 170 100s90-10 160-40v160H-10Z" fill="#B2BEC8" opacity=".6" />
      <path d="M20 40h90v50H20zM130 30h70v36h-70zM220 70h80v60h-80zM40 120h80v50H40z" fill="#F6F0E7" />
      <path d="M0 100 320 80M110 0 140 200" stroke="#FFFEFB" strokeWidth="8" />
      <circle cx="170" cy="92" r="26" fill="#DF776E" fillOpacity=".25" className="pin-pulse" />
      <path d="M170 112s-14-12-14-24a14 14 0 1 1 28 0c0 12-14 24-14 24Z" fill="#DF776E" stroke="#182B3A" strokeWidth="3" />
      <circle cx="170" cy="88" r="4.500" fill="#182B3A" />
    </svg>
  )
}
