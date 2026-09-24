/**
 * Where the Search screen's comparison bar is drawn (T12): an element the tab chrome renders between the scrolling
 * area and the tab bar. The Search screen portals the bar into it, so the bar takes its own space instead of
 * floating over the results.
 */
import { createContext } from "react";

export const TraySlot = createContext<HTMLElement | null>(null);
