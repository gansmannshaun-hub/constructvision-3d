// Central brand / contact constants. Change here → everywhere.
export const BRAND_NAME = "Gonzo Labs";
export const CONTACT_EMAIL = "gonzo.ai.labs@gmail.com";
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;

/** Prefilled mailto with a subject line. Handy for CTAs that want to
 *  pre-tag the incoming message by app / topic. */
export function mailtoWithSubject(subject) {
  const q = new URLSearchParams({ subject }).toString();
  return `${CONTACT_MAILTO}?${q}`;
}
