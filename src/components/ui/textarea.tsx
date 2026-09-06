import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-line-strong bg-bg px-2.5 py-2 text-base text-fg placeholder:text-fg-muted disabled:cursor-not-allowed disabled:border-line disabled:bg-bg-raised disabled:text-fg-muted aria-invalid:border-error md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
