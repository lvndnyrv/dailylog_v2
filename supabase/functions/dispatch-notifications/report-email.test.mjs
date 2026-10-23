import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduledReportEmailText, scheduledReportLink } from './report-email.ts';

const report = {
  type: 'scheduled_report',
  reportKind: 'incidents',
  startsOn: '2026-10-01',
  endsOn: '2026-10-15',
};

test('scheduled report email includes a center-protected report URL when configured', () => {
  const text = scheduledReportEmailText('Your report is ready.', report, 'https://dailylog.example/');
  assert.match(text, /Your report is ready\./);
  assert.match(text, /https:\/\/dailylog\.example\/reports\/incidents\?from=2026-10-01&to=2026-10-15/);
});

test('missing or unsafe origin falls back to in-app navigation', () => {
  assert.equal(scheduledReportLink(report, 'http://example.com'), null);
  assert.equal(scheduledReportLink(report, 'https://user:pass@example.com'), null);
  assert.match(scheduledReportEmailText('Ready.', report, undefined), /Sign in to DailyLog and open Reports/);
});

test('untrusted payload cannot turn the email into an arbitrary link', () => {
  assert.equal(scheduledReportLink({ ...report, reportKind: '../settings' }, 'https://dailylog.example'), null);
  assert.equal(scheduledReportLink({ ...report, startsOn: '2026-02-30' }, 'https://dailylog.example'), null);
  assert.equal(scheduledReportLink({ ...report, startsOn: '2026-10-16' }, 'https://dailylog.example'), null);
  assert.equal(scheduledReportLink({ ...report, reportPath: 'https://evil.example' }, 'https://dailylog.example'),
    'https://dailylog.example/reports/incidents?from=2026-10-01&to=2026-10-15');
});

test('other email kinds keep their existing body', () => {
  assert.equal(scheduledReportEmailText('Hello', { type: 'announcement' }, 'https://dailylog.example'), 'Hello');
});
