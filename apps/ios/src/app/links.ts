/**
 * The static site's pages the app links to (release decision D7): the privacy policy and the support page, built from
 * sites/landing and served at https://awardgrid.dowhiz.com. Settings › About opens them in Safari (`target="_blank"`,
 * which Capacitor hands to the system); the app itself never requests them, and they carry no data from it.
 */
export const SITE_URL = "https://awardgrid.dowhiz.com/";
export const PRIVACY_POLICY_URL = `${SITE_URL}privacy/`;
export const SUPPORT_URL = `${SITE_URL}support/`;

/**
 * seats.aero's own site, linked from "Data: seats.aero" wherever results from seats.aero are shown
 * (components/SeatsAttribution.tsx). Opened in Safari like the pages above; the app never requests it.
 */
export const SEATS_AERO_URL = "https://seats.aero";
