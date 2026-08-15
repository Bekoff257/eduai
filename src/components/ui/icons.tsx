type IconProps = { className?: string };

function base(paths: React.ReactNode) {
  return function Icon({ className = "h-4 w-4" }: IconProps) {
    return (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {paths}
      </svg>
    );
  };
}

export const OverviewIcon = base(
  <>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </>
);

export const ConversationsIcon = base(
  <path d="M21 12a8 8 0 1 1-3.2-6.4L21 4l-1 4.2A7.9 7.9 0 0 1 21 12Z" />
);

export const CustomersIcon = base(
  <>
    <circle cx="9" cy="8" r="3.25" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.5a3.25 3.25 0 0 1 0 6.5" />
    <path d="M15 13.5a6.5 6.5 0 0 1 6.5 6.5" />
  </>
);

export const LeadsIcon = base(
  <>
    <path d="M3 5h18l-7 8.5V20l-4-2v-4.5L3 5Z" />
  </>
);

export const CoursesIcon = base(
  <>
    <path d="M2 6.5 12 3l10 3.5-10 3.5-10-3.5Z" />
    <path d="M6 9.5V16c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V9.5" />
    <path d="M21 8v6.5" />
  </>
);

export const AppointmentsIcon = base(
  <>
    <rect x="3" y="4.5" width="18" height="16" rx="2" />
    <path d="M3 9.5h18" />
    <path d="M8 3v3M16 3v3" />
  </>
);

export const TelegramIcon = base(
  <path d="m21 4-3 16-6-4.5L8.5 18l.7-5L18 6l-11 6-4-1.5L21 4Z" />
);

export const AISettingsIcon = base(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2.2M12 18.8V21M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M3 12h2.2M18.8 12H21M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
  </>
);

export const AutomationsIcon = base(<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />);

export const OrgSettingsIcon = base(
  <>
    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
    <path d="M19.4 13.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V20a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H4a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H10a1.7 1.7 0 0 0 1-1.6V4a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V10a1.7 1.7 0 0 0 1.6 1H20a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.6 1Z" />
  </>
);

export const MenuIcon = base(<path d="M3 6h18M3 12h18M3 18h18" />);
export const CloseIcon = base(<path d="M5 5l14 14M19 5 5 19" />);
export const ChevronDownIcon = base(<path d="m6 9 6 6 6-6" />);
export const SearchIcon = base(
  <>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m20 20-4.35-4.35" />
  </>
);
export const PlusIcon = base(<path d="M12 5v14M5 12h14" />);
