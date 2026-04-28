const parseBirthDate = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const clampAge = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const parseYearMonth = (value: string) => {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }

  return { year, month };
};

const getLastDayOfMonth = (year: number, month: number) => new Date(year, month, 0).getDate();


export const formatYearMonthFromAge = (
  age: number,
  dateOfBirth: string,
  currentAge: number,
  referenceDate = new Date()
) => {
  const birthDate = parseBirthDate(dateOfBirth);

  if (birthDate) {
    const year = birthDate.getFullYear() + Math.floor(age);
    const month = String(birthDate.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  const year = referenceDate.getFullYear() + Math.floor(age - currentAge);
  const month = String(referenceDate.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

export const ageFromYearMonth = (
  yearMonth: string,
  dateOfBirth: string,
  currentAge: number,
  minAge: number,
  maxAge: number,
  referenceDate = new Date()
) => {
  const parsedYearMonth = parseYearMonth(yearMonth);
  if (!parsedYearMonth) {
    return null;
  }

  const birthDate = parseBirthDate(dateOfBirth);

  if (birthDate) {
    const referenceForAge = new Date(
      parsedYearMonth.year,
      parsedYearMonth.month - 1,
      getLastDayOfMonth(parsedYearMonth.year, parsedYearMonth.month)
    );
    let age = referenceForAge.getFullYear() - birthDate.getFullYear();
    const monthDifference = referenceForAge.getMonth() - birthDate.getMonth();

    if (monthDifference < 0 || (monthDifference === 0 && referenceForAge.getDate() < birthDate.getDate())) {
      age -= 1;
    }

    return clampAge(age, minAge, maxAge);
  }

  const currentSerial = referenceDate.getFullYear() * 12 + referenceDate.getMonth();
  const targetSerial = parsedYearMonth.year * 12 + (parsedYearMonth.month - 1);
  const monthDelta = targetSerial - currentSerial;
  const derivedAge = currentAge + Math.floor(monthDelta / 12);

  return clampAge(derivedAge, minAge, maxAge);
};
