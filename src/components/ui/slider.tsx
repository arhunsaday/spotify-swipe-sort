import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      // vertical padding only — it grows the hitbox without shifting the
      // pointer→value mapping (Radix measures the root's width).
      "group relative flex w-full cursor-pointer touch-none select-none items-center py-2.5",
      className,
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-secondary transition-[height] duration-150 group-hover:h-1.5 group-focus-within:h-1.5">
      <SliderPrimitive.Range className="absolute h-full bg-primary" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-3.5 w-3.5 rounded-full border border-primary/50 bg-white opacity-0 shadow transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none group-hover:opacity-100 data-[state]:opacity-100" />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
