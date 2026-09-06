import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        // 36 px, 1 px --line-strong, 4 px radius; 16 px type below md so iOS does not zoom the field.
        "h-9 w-full min-w-0 rounded-lg border border-line-strong bg-bg px-2.5 py-1 text-base text-fg file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-fg placeholder:text-fg-muted disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-line disabled:bg-bg-raised disabled:text-fg-muted aria-invalid:border-error md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
