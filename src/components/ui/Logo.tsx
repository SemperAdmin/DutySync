interface LogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  className?: string;
}

export default function Logo({
  size = "md",
  showText = true,
  className = "",
}: LogoProps) {
  const sizes = {
    sm: { icon: 32, text: "text-lg" },
    md: { icon: 48, text: "text-2xl" },
    lg: { icon: 64, text: "text-3xl" },
  };

  const { icon, text } = sizes[size];

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Shield Icon with Sync Symbol */}
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
      >
        {/* Shield Background */}
        <path
          d="M32 4L8 14V30C8 46 18.4 58.4 32 62C45.6 58.4 56 46 56 30V14L32 4Z"
          fill="#1A237E"
          stroke="#FFC107"
          strokeWidth="2"
        />
        {/* Inner Shield */}
        <path
          d="M32 10L14 18V30C14 42.8 22.8 52.8 32 56C41.2 52.8 50 42.8 50 30V18L32 10Z"
          fill="#0a0a0f"
        />
        {/* Sync Arrows */}
        <g stroke="#FFC107" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          {/* Top Arrow */}
          <path d="M24 28C24 24 27.5 21 32 21C35.5 21 38.5 23 39.5 26" />
          <path d="M37 23L40 26L37 29" />
          {/* Bottom Arrow */}
          <path d="M40 36C40 40 36.5 43 32 43C28.5 43 25.5 41 24.5 38" />
          <path d="M27 41L24 38L27 35" />
        </g>
        {/* Center Star */}
        <path
          d="M32 30L33.5 33H36.5L34 35L35 38L32 36L29 38L30 35L27.5 33H30.5L32 30Z"
          fill="#D32F2F"
        />
      </svg>
      {showText && (
        <div className="flex flex-col">
          <span className={`font-bold ${text} text-foreground leading-tight`}>
            Duty Sync
          </span>
          <span className="text-xs text-foreground-muted uppercase tracking-wider">
            Roster Management
          </span>
          <span className="text-xs text-foreground-muted mt-0.5">
            by <span className="font-semibold text-highlight">Semper Admin</span>
          </span>
        </div>
      )}
    </div>
  );
}
