import Image from "next/image";
import { cn } from "./ui";

/** Compact crop of the padded NebTech source artwork. */
export function BrandLogo({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = { sm: "h-8 w-8", md: "h-9 w-9", lg: "h-10 w-10" };

  return (
    <span
      className={cn(
        "relative block shrink-0 overflow-hidden rounded-xl bg-[#082f67] shadow-sm ring-1 ring-white/15",
        sizes[size],
        className,
      )}
      aria-hidden="true"
    >
      <Image
        src="/images/nebtech-logo.png"
        alt=""
        width={2000}
        height={2000}
        className="pointer-events-none absolute left-[-40%] top-[-162%] h-auto w-[500%] max-w-none select-none"
      />
    </span>
  );
}
