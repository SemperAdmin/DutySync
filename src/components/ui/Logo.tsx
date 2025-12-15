import Image from "next/image";

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
    sm: { icon: 40, text: "text-lg" },
    md: { icon: 56, text: "text-2xl" },
    lg: { icon: 80, text: "text-3xl" },
  };

  const { icon, text } = sizes[size];

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <Image
        src="/images/logo.png"
        alt="Semper Admin Logo"
        width={icon}
        height={icon}
        className="flex-shrink-0"
        priority
      />
      {showText && (
        <div className="flex flex-col">
          <span className={`font-bold ${text} text-foreground leading-tight`}>
            Duty Sync
          </span>
          <span className="text-xs text-foreground-muted uppercase tracking-wider">
            Roster Management
          </span>
        </div>
      )}
    </div>
  );
}
