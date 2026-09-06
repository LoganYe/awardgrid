"use client"

import * as React from "react"
import { cn } from "cn"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-5 text-fg select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:text-fg-muted peer-disabled:cursor-not-allowed peer-disabled:text-fg-muted",
        className
      )}
      {...props}
    />
  )
}

export { Label }
