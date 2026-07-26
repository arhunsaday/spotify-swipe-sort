import { cn } from "@/lib/utils";

export function Kbd({
  children,
  className,
  large,
}: {
  children: React.ReactNode;
  className?: string;
  large?: boolean;
}) {
  return (
    <kbd className={cn("kbd", large && "kbd-lg", className)}>{children}</kbd>
  );
}
