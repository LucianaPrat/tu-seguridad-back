import { AlertType } from '@prisma/client';

/**
 * The alert email, as an incident notice rather than a product announcement.
 *
 * The design brief this answers: a person reads it on a phone, possibly at 3am,
 * and has to decide in about three seconds whether it needs them. So the frame
 * the camera actually captured is the hero — no logo, no banner above it — and
 * everything the recorder measured is set in monospace while everything the
 * system says to a person is set in prose. That split is the whole type system,
 * and it encodes something true: what a machine observed versus what we are
 * telling you about it.
 *
 * The signature element is the timecode strip under the frame, the burnt-in
 * channel label and timestamp of a recorder's on-screen display. It carries
 * real information — which camera, exactly when — and it is the one place the
 * design is loud.
 *
 * Email constraints are not negotiable: table layout, inline styles, no web
 * font, no external asset. The only embedded stylesheet is a media query for
 * stacking the buttons, which every client is free to ignore.
 */

/** Per alert type: how it is announced, and the one colour that is allowed to shout. */
const ALERT_PRESENTATION: Record<
  AlertType,
  { eyebrow: string; sentence: (camera: string) => string; signal: string }
> = {
  intruder: {
    eyebrow: 'Intruder alert',
    sentence: (camera) => `A person was detected at ${camera}.`,
    signal: '#C8371B',
  },
  suspicious: {
    eyebrow: 'Suspicious activity',
    sentence: (camera) => `Unusual activity at ${camera}.`,
    signal: '#B0761A',
  },
};

const INK = '#12161C';
const PAPER = '#FFFFFF';
const GROUND = '#F2F4F7';
const MUTED = '#5B6673';
const LINE = '#E3E7EC';

const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO =
  "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

export interface AlertMailContent {
  alertType: AlertType;
  cameraLabel: string;
  detectedAt: Date;
  timezone: string;
  personsDetected: number | null;
  /** Highest `detScore` of the frame, 0..1. Null on an alert recorded before the column existed. */
  confidence: number | null;
  recipientFirstName: string;
  eventUrl: string;
  acknowledgeUrl: string;
  /** Content id of the inline snapshot, or null when the alert stored no frame. */
  snapshotCid: string | null;
}

export interface AlertMail {
  subject: string;
  text: string;
  html: string;
}

/**
 * The camera label and the member's name are operator-supplied text, and the
 * HTML part is the one place they stop being data. A label of `<a href="…">`
 * would otherwise render as a link the recipient can click. URLs go through it
 * too: in an attribute, `&` has to be `&amp;`.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Wall-clock time at the recorder, which is where the person reading this
 * actually lives. Falls back to UTC if the DVR carries a time zone Node cannot
 * resolve — an unreadable timestamp is worse than an offset one.
 */
function formatDetectedAt(
  detectedAt: Date,
  timezone: string,
): { date: string; time: string; zone: string } {
  for (const zone of [timezone, 'UTC']) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).formatToParts(detectedAt);
      const at = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((part) => part.type === type)?.value ?? '';
      return {
        date: `${at('year')}-${at('month')}-${at('day')}`,
        time: `${at('hour')}:${at('minute')}:${at('second')}`,
        zone,
      };
    } catch {
      continue;
    }
  }
  // Unreachable: 'UTC' always resolves. Keeps the return type honest.
  return {
    date: detectedAt.toISOString().slice(0, 10),
    time: detectedAt.toISOString().slice(11, 19),
    zone: 'UTC',
  };
}

function button(
  href: string,
  label: string,
  background: string,
  color: string,
  border: string,
): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td align="center" bgcolor="${background}" style="border-radius:8px;border:1px solid ${border};"><a href="${escapeHtml(href)}" style="display:inline-block;padding:15px 26px;font-family:${SANS};font-size:15px;font-weight:600;line-height:1;color:${color};text-decoration:none;border-radius:8px;">${label}</a></td></tr></table>`;
}

function factRow(label: string, value: string): string {
  return `<tr><td style="padding:0 0 10px 0;font-family:${SANS};font-size:13px;color:${MUTED};width:40%;">${label}</td><td style="padding:0 0 10px 0;font-family:${MONO};font-size:13px;color:${INK};text-align:right;">${value}</td></tr>`;
}

export function buildAlertMail(content: AlertMailContent): AlertMail {
  const presentation = ALERT_PRESENTATION[content.alertType];
  const when = formatDetectedAt(content.detectedAt, content.timezone);
  const subject = `${presentation.eyebrow} — ${content.cameraLabel}`;
  const sentence = presentation.sentence(content.cameraLabel);
  const people =
    content.personsDetected === null ? null : String(content.personsDetected);
  // The number the detector reported, as the whole percent a person reads at a
  // glance. Fractions of a percent say nothing about whether to get up.
  const confidence =
    content.confidence === null
      ? null
      : `${Math.round(content.confidence * 100)}%`;

  const preheader = [
    `${when.time} at ${content.cameraLabel}`,
    people === null ? null : `${people} in frame`,
  ]
    .filter(Boolean)
    .join(' · ');

  // No greeting, in either part. This is an incident notice, and the first line
  // has to be the incident; the recipient's name belongs in the footer that
  // explains why the message arrived at all.
  const footer =
    `Sent to ${content.recipientFirstName} because alerts for this space go out by email. ` +
    `Change that in the dashboard, under Members.`;

  const text = [
    sentence,
    '',
    `Camera:   ${content.cameraLabel}`,
    `Detected: ${when.date} ${when.time} (${when.zone})`,
    ...(people === null ? [] : [`People:   ${people}`]),
    ...(confidence === null ? [] : [`Match:    ${confidence} confidence`]),
    '',
    `View the alert:   ${content.eventUrl}`,
    `Mark as handled:  ${content.acknowledgeUrl}`,
    '',
    footer,
  ].join('\n');

  const frame = content.snapshotCid
    ? `<img src="cid:${escapeHtml(content.snapshotCid)}" width="600" alt="Frame captured at ${escapeHtml(when.time)} by ${escapeHtml(content.cameraLabel)}, each detected person outlined in green" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;background-color:${INK};" />`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>${escapeHtml(subject)}</title>
<style>
@media (max-width:480px){
  .stack{display:block !important;width:100% !important;padding:0 0 12px 0 !important;}
  .pad{padding-left:22px !important;padding-right:22px !important;}
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${GROUND};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${GROUND};">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:${PAPER};border:1px solid ${LINE};border-radius:12px;overflow:hidden;">

<tr><td class="pad" style="padding:30px 34px 22px 34px;border-top:3px solid ${presentation.signal};">
<div style="font-family:${MONO};font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${presentation.signal};padding-bottom:12px;">${escapeHtml(presentation.eyebrow)}</div>
<div style="font-family:${SANS};font-size:23px;line-height:1.32;font-weight:600;color:${INK};">${escapeHtml(sentence)}</div>
</td></tr>

<tr><td style="padding:0;">${frame}</td></tr>

<tr><td style="padding:0;background-color:${INK};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding:11px 10px 11px 34px;font-family:${MONO};font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#9AA6B2;">${escapeHtml(content.cameraLabel)}</td>
<td align="right" style="padding:11px 34px 11px 10px;font-family:${MONO};font-size:11px;letter-spacing:0.06em;color:#FFFFFF;white-space:nowrap;">${escapeHtml(when.time)}</td>
</tr></table>
</td></tr>

<tr><td class="pad" style="padding:24px 34px 4px 34px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${factRow('Detected', `${escapeHtml(when.date)} ${escapeHtml(when.time)}`)}
${factRow('Time zone', escapeHtml(when.zone))}
${people === null ? '' : factRow('People in frame', escapeHtml(people))}
${confidence === null ? '' : factRow('Detection confidence', escapeHtml(confidence))}
</table>
</td></tr>

<tr><td class="pad" style="padding:12px 34px 30px 34px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="stack" style="padding:0 10px 0 0;">${button(content.eventUrl, 'View the alert', INK, '#FFFFFF', INK)}</td>
<td class="stack" style="padding:0;">${button(content.acknowledgeUrl, 'Mark as handled', PAPER, INK, LINE)}</td>
</tr></table>
</td></tr>

<tr><td class="pad" style="padding:18px 34px 24px 34px;border-top:1px solid ${LINE};font-family:${SANS};font-size:12px;line-height:1.55;color:${MUTED};">
${escapeHtml(footer)}
</td></tr>

</table>
</td></tr></table>
</body></html>`;

  return { subject, text, html };
}
