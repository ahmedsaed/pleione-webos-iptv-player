import { bidiIsolate, t } from '../i18n';

export function formatEpgOffset(minutes: number): string {
  if (!minutes) return t('settings.offsetZero');
  const sign = minutes > 0 ? '+' : '-';
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  return hours
    ? `${bidiIsolate(sign + String(hours))} ${t('settings.offsetHours')}${
      remainder ? ` ${String(remainder)} ${t('settings.offsetMinutes')}` : ''
    }`
    : `${bidiIsolate(sign + String(remainder))} ${t('settings.offsetMinutes')}`;
}
