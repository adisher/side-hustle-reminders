import { readFileSync } from 'node:fs';
import nodemailer from 'nodemailer';

const tasks = JSON.parse(
  readFileSync(new URL('../data/tasks.json', import.meta.url), 'utf8')
);

const CATEGORIES = [
  { key: 'physical', name: 'Physical', color: '#22c55e' },
  { key: 'mindset', name: 'Mindset', color: '#a78bfa' },
  { key: 'business', name: 'Business', color: '#f59e0b' },
];

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

// Shift "now" by the configured offset, then read UTC fields off the shifted
// Date. Vercel runs in UTC, so never rely on the server's local timezone.
export function localNow(offsetHours, now = Date.now()) {
  const shifted = new Date(now + offsetHours * 3600 * 1000);
  return { date: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() };
}

function renderHtml(entry, label, date) {
  const rows = CATEGORIES.map(
    (c) => `
      <tr>
        <td style="padding:14px 12px 14px 0;border-bottom:1px solid #222;vertical-align:top;width:90px;">
          <span style="color:${c.color};font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">${c.name}</span>
        </td>
        <td style="padding:14px 0;border-bottom:1px solid #222;color:#e6e9e6;font-size:15px;line-height:1.5;">${entry[c.key] ?? ''}</td>
      </tr>`
  ).join('');

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0d0f0e;">
    <div style="background:#0d0f0e;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <div style="max-width:560px;margin:0 auto;color:#e6e9e6;">
        <div style="color:#a3e635;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;">${label}</div>
        <h1 style="margin:0 0 6px;font-size:26px;color:#e6e9e6;">Day ${entry.day} of 45</h1>
        <div style="color:#8a918c;font-size:13px;margin-bottom:20px;">Week ${entry.week} · ${entry.phase} · ${date}</div>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rows}
        </table>
        <p style="color:#8a918c;font-size:13px;margin:24px 0 0;">Check in on the portal, then log the day.</p>
      </div>
    </div>
  </body>
</html>`;
}

function renderText(entry, label, date) {
  return [
    label,
    `Day ${entry.day} of 45`,
    `Week ${entry.week} · ${entry.phase} · ${date}`,
    '',
    ...CATEGORIES.map((c) => `${c.name}: ${entry[c.key] ?? ''}`),
    '',
    'Check in on the portal, then log the day.',
  ].join('\n');
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');

  // 1. Auth guard
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const provided = bearer ?? url.searchParams.get('key');
    if (provided !== secret) {
      return send(res, 401, { error: 'unauthorized' });
    }
  }

  // 2. Local time
  const { date, hour } = localNow(tasks.timezone_offset_hours);

  // 3. Lookup
  const entry = tasks.days[date];
  if (!entry) {
    return send(res, 200, { sent: false, reason: `no tasks for ${date}` });
  }

  // 4. Slot check
  const force = url.searchParams.get('force') === '1';
  const slot = tasks.reminder_hours.find((r) => r.hour === hour);
  if (!slot && !force) {
    return send(res, 200, { sent: false, reason: 'not a reminder hour', hour });
  }
  const label = force ? 'Manual send' : slot.label;

  // 5. Send
  try {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    await transport.sendMail({
      from: process.env.MAIL_FROM,
      to: process.env.MAIL_TO,
      subject: `Day ${entry.day}/45 — ${label}`,
      html: renderHtml(entry, label, date),
      text: renderText(entry, label, date),
    });
  } catch (err) {
    // 6. Errors
    return send(res, 502, { sent: false, error: err.message });
  }

  return send(res, 200, { sent: true, day: entry.day, slot: label, hour });
}
