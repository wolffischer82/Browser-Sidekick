import type { ComponentChildren } from 'preact';

/**
 * Small stroke icons (redesign spec 4.3: 1.8 px stroke, round caps and joins);
 * decorative, so every button carries its own label.
 */
function Icon({ children }: { children: ComponentChildren }) {
  return (
    <svg
      class="icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Sessions: three lines, the third one shorter. */
export const MenuIcon = () => (
  <Icon>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

/** Settings: two sliders. */
export const SlidersIcon = () => (
  <Icon>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);

export const BackIcon = () => (
  <Icon>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </Icon>
);

export const ChevronIcon = () => (
  <Icon>
    <path d="m9 18 6-6-6-6" />
  </Icon>
);

export const ChevronDownIcon = () => (
  <Icon>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

/** Pin needle, outline: pins the current tab (D9). */
export const PinIcon = () => (
  <Icon>
    <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" />
    <path d="M12 14v7" />
  </Icon>
);

/** Pin needle, filled: the page is pinned; the button unpins it. */
export const PinFilledIcon = () => (
  <Icon>
    <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" fill="currentColor" />
    <path d="M12 14v7" />
  </Icon>
);

export const EyeIcon = () => (
  <Icon>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const EyeOffIcon = () => (
  <Icon>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
    <path d="M3 3l18 18" />
  </Icon>
);

export const OpenIcon = () => (
  <Icon>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Icon>
);

export const RefreshIcon = () => (
  <Icon>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
  </Icon>
);

/** Stands in for a missing favicon. */
export const GlobeIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </Icon>
);

/** Thinking level. */
export const LightbulbIcon = () => (
  <Icon>
    <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
  </Icon>
);

/** Summarize: lines of falling length. */
export const LinesIcon = () => (
  <Icon>
    <path d="M4 6h16M4 12h10M4 18h7" />
  </Icon>
);

/** Send: arrow up. */
export const ArrowUpIcon = () => (
  <Icon>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </Icon>
);

/** A pinned YouTube video without a favicon. */
export const PlayIcon = () => (
  <Icon>
    <path d="M8 5v14l11-7z" fill="currentColor" />
  </Icon>
);

/** A pinned PDF without a favicon. */
export const FileIcon = () => (
  <Icon>
    <path d="M14 3H6v18h12V7z" />
    <path d="M14 3v4h4" />
  </Icon>
);

/** Page access. */
export const ShieldIcon = () => (
  <Icon>
    <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
  </Icon>
);

/** A pin being extracted; turns in CSS unless motion is reduced. */
export const SpinnerIcon = () => (
  <Icon>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </Icon>
);
