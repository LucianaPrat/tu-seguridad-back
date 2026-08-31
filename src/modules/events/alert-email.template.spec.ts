import { AlertMailContent, buildAlertMail } from './alert-email.template';

function content(overrides: Partial<AlertMailContent> = {}): AlertMailContent {
  return {
    alertType: 'intruder',
    cameraLabel: 'Front door – Street side',
    detectedAt: new Date('2026-08-31T14:05:00.000Z'),
    timezone: 'America/Montevideo',
    personsDetected: 2,
    recipientFirstName: 'Ada',
    eventUrl: 'http://localhost:5173/app/events/event-1',
    acknowledgeUrl:
      'http://localhost:5173/app/events/event-1/acknowledge?token=delivery-1.sig',
    snapshotCid: 'alert-frame',
    ...overrides,
  };
}

describe('buildAlertMail', () => {
  it('names the alert type and the camera in the subject', () => {
    expect(buildAlertMail(content()).subject).toBe(
      'Intruder alert — Front door – Street side',
    );
    expect(buildAlertMail(content({ alertType: 'suspicious' })).subject).toBe(
      'Suspicious activity — Front door – Street side',
    );
  });

  it('renders the detection time in the recorder time zone, not UTC', () => {
    const mail = buildAlertMail(content());

    // 14:05 UTC is 11:05 in Montevideo (UTC-3).
    expect(mail.text).toContain('2026-08-31 11:05:00 (America/Montevideo)');
    expect(mail.html).toContain('11:05:00');
  });

  it('falls back to UTC when the recorder carries an unusable time zone', () => {
    const mail = buildAlertMail(content({ timezone: 'Mars/Olympus_Mons' }));

    expect(mail.text).toContain('2026-08-31 14:05:00 (UTC)');
  });

  it('shows the frame inline by content id', () => {
    expect(buildAlertMail(content()).html).toContain('src="cid:alert-frame"');
  });

  it('drops the image entirely when the alert stored no frame', () => {
    const html = buildAlertMail(content({ snapshotCid: null })).html;

    expect(html).not.toContain('<img');
    expect(html).toContain('Front door – Street side');
  });

  it('carries both actions, in both parts', () => {
    const mail = buildAlertMail(content());

    for (const part of [mail.text, mail.html]) {
      expect(part).toContain('http://localhost:5173/app/events/event-1');
      expect(part).toContain('token=delivery-1.sig');
    }
    expect(mail.html).toContain('View the alert');
    expect(mail.html).toContain('Mark as handled');
  });

  it('omits the head count rather than printing a placeholder for it', () => {
    const mail = buildAlertMail(content({ personsDetected: null }));

    expect(mail.text).not.toContain('People');
    expect(mail.html).not.toContain('People in frame');
  });

  it('escapes operator-supplied text in the html part', () => {
    const mail = buildAlertMail(
      content({ cameraLabel: '<a href="http://evil.example">Gate</a>' }),
    );

    expect(mail.html).not.toContain('<a href="http://evil.example">');
    expect(mail.html).toContain('&lt;a href=&quot;http://evil.example&quot;');
    // The text part is not HTML, so it carries the label as typed.
    expect(mail.text).toContain('<a href="http://evil.example">Gate</a>');
  });

  it('names the recipient where it explains why the mail arrived', () => {
    const mail = buildAlertMail(content());

    expect(mail.html).toContain('Sent to Ada because');
    expect(mail.text).toContain('Sent to Ada because');
    // Not a greeting: the first line has to be the incident.
    expect(mail.text.startsWith('A person was detected at')).toBe(true);
  });

  it('stays email-client-safe: no external asset, no layout the clients drop', () => {
    const html = buildAlertMail(content()).html;

    expect(html).not.toMatch(/src="https?:/);
    expect(html).not.toMatch(/@font-face|<link/);
    expect(html).not.toMatch(/display:\s*(flex|grid)/);
    expect(html).toContain('role="presentation"');
  });
});
