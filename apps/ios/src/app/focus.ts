/**
 * A page reached from a link that unmounts on the way (a settings row, the welcome's buttons) takes focus on its
 * title, so VoiceOver and the keyboard start there instead of on nothing (T11). The title needs `tabIndex={-1}`.
 */
import { type RefObject, useEffect } from "react";

export function useFocusOnArrival(title: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, [title]);
}
