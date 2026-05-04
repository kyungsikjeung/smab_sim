const padNumber = (value: number, digits = 2) => String(value).padStart(digits, '0');

const buildFallbackDateTime = (date: Date, includeMilliseconds = false) => {
  const datePart = [
    date.getFullYear(),
    padNumber(date.getMonth() + 1),
    padNumber(date.getDate()),
  ].join('-');

  const timePart = [
    padNumber(date.getHours()),
    padNumber(date.getMinutes()),
    padNumber(date.getSeconds()),
  ].join(':');

  if (!includeMilliseconds) {
    return `${datePart} ${timePart}`;
  }

  return `${datePart} ${timePart}.${padNumber(date.getMilliseconds(), 3)}`;
};

const normalizeDateInput = (value: Date | number | string) => (
  value instanceof Date ? value : new Date(value)
);

export const formatTimeWithMilliseconds = (value: Date | number | string = new Date()) => {
  const date = normalizeDateInput(value);
  if (Number.isNaN(date.getTime())) {
    return '--:--:--.---';
  }

  try {
    return date.toLocaleTimeString('ko-KR', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  } catch (_error) {
    return buildFallbackDateTime(date, true).split(' ')[1];
  }
};

export const formatDateTime = (value: Date | number | string) => {
  const date = normalizeDateInput(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  try {
    return date.toLocaleString('ko-KR', { hour12: false });
  } catch (_error) {
    return buildFallbackDateTime(date);
  }
};
