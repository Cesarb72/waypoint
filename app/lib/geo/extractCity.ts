function isNumericish(value: string): boolean {
  return /\d/.test(value);
}

export function extractCity(formattedAddress: string | null | undefined): string | null {
  if (typeof formattedAddress !== 'string') return null;
  const trimmed = formattedAddress.trim();
  if (!trimmed) return null;

  const parts = trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;

  const lastPart = parts[parts.length - 1] ?? '';
  const candidate =
    parts.length >= 3 && !isNumericish(lastPart)
      ? parts[parts.length - 3]
      : parts[parts.length - 2];
  const city = candidate?.trim() ?? '';
  return city || null;
}

// Smoke cases for quick manual checks:
// "Unit 73, ..., Portadown, Craigavon BT63 5WH, UK" => "Portadown"
// "1 Market St, San Francisco, CA 94105" => "San Francisco"
// "Seattle, WA 98101" => "Seattle"
export function getExtractCitySmokeCases(): Array<{
  input: string | null | undefined;
  expected: string | null;
}> {
  return [
    {
      input: 'Unit 73, High St Mall, Portadown, Craigavon BT63 5WH, UK',
      expected: 'Portadown',
    },
    {
      input: '1 Market St, San Francisco, CA 94105',
      expected: 'San Francisco',
    },
    {
      input: 'Seattle, WA 98101',
      expected: 'Seattle',
    },
  ];
}
