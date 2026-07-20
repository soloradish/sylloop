interface PinIconProps {
  pinned: boolean;
}

export function PinIcon({ pinned }: PinIconProps) {
  return (
    <svg
      className="pin-icon"
      viewBox="0 0 24 24"
      width="17"
      height="17"
      aria-hidden="true"
      data-testid={pinned ? "pin-icon-filled" : "pin-icon-outline"}
    >
      <path
        d="M8.1 3.75h7.8l-1.25 5.1 2.6 2.6v1.8H6.75v-1.8l2.6-2.6-1.25-5.1Z"
        fill={pinned ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinejoin="round"
      />
      <path d="M12 13.25v7" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
    </svg>
  );
}
