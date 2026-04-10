import {
  RegisterValueFormat,
  RohmBitfieldDefinition,
  RohmRegisterByteMap,
  RohmRegisterFieldRow,
  RohmRegisterMap,
} from 'types';

const sortNumeric = (a: number, b: number) => a - b;

const getAddressDigits = (value: number, minimumDigits: number): number => {
  const rawDigits = value.toString(16).toUpperCase().length;
  return Math.max(minimumDigits, rawDigits);
};

export const formatRohmHex = (value: number, minimumDigits = 2): string =>
  `0x${value.toString(16).toUpperCase().padStart(getAddressDigits(value, minimumDigits), '0')}`;

export const formatRohmByte = (value: number): string =>
  `0x${(value & 0xff).toString(16).toUpperCase().padStart(2, '0')}`;

export const parseFlexibleNumber = (input: string): number | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    return parseInt(trimmed, 16);
  }

  if (/^[0-9]+$/i.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  return null;
};

export const getUniqueRegisterAddresses = (registerMap: RohmRegisterMap): number[] => {
  const addresses = new Set<number>();
  registerMap.bitfields.forEach((field) => {
    field.subfields.forEach((subfield) => {
      addresses.add(subfield.address);
    });
  });
  return Array.from(addresses).sort(sortNumeric);
};

const getFieldBitRange = (field: RohmBitfieldDefinition) => {
  const starts = field.subfields.map((subfield) => subfield.start);
  const ends = field.subfields.map((subfield) => subfield.end);

  return {
    minStart: Math.min(...starts),
    maxEnd: Math.max(...ends),
  };
};

const getFieldBitLength = (field: RohmBitfieldDefinition): number => {
  const { minStart, maxEnd } = getFieldBitRange(field);
  return maxEnd - minStart + 1;
};

const getFieldAddressSpan = (field: RohmBitfieldDefinition): number[] =>
  Array.from(new Set(field.subfields.map((subfield) => subfield.address))).sort(sortNumeric);

export const getRohmFieldKey = (field: RohmBitfieldDefinition): string => {
  const addressSpan = getFieldAddressSpan(field);
  return `${addressSpan[0]}-${field.name}`;
};

const resolveFieldValue = (field: RohmBitfieldDefinition, rawBytes: RohmRegisterByteMap) => {
  const { minStart } = getFieldBitRange(field);
  let value = 0;

  for (const subfield of field.subfields) {
    const rawByte = rawBytes[subfield.address];
    if (typeof rawByte !== 'number') {
      return {
        resolved: false,
        value: null as number | null,
      };
    }

    const mask = (1 << subfield.length) - 1;
    const source = (rawByte >> subfield.offset) & mask;
    value += source * (2 ** (subfield.start - minStart));
  }

  return {
    resolved: true,
    value,
  };
};

export const formatRohmFieldValue = (
  fieldValue: number | null,
  bitLength: number,
  format: RegisterValueFormat
): string => {
  if (fieldValue === null) return '--';
  if (format === 'dec') return `${fieldValue}`;
  const hexDigits = Math.max(1, Math.ceil(bitLength / 4));
  return `0x${fieldValue.toString(16).toUpperCase().padStart(hexDigits, '0')}`;
};

const formatFieldRawBytes = (addresses: number[], rawBytes: RohmRegisterByteMap): string =>
  addresses
    .map((address) => (typeof rawBytes[address] === 'number' ? formatRohmByte(rawBytes[address]) : '??'))
    .join(' ');

const formatAccess = (field: RohmBitfieldDefinition): string => {
  if (field.readable && field.writable) return 'R/W';
  if (field.readable) return 'R';
  if (field.writable) return 'W';
  return '-';
};

export const buildRohmFieldWriteBytes = (
  field: RohmBitfieldDefinition,
  rawBytes: RohmRegisterByteMap,
  nextValue: number
): Array<{ address: number; value: number }> | null => {
  const bitLength = getFieldBitLength(field);
  const maxValue = (2 ** bitLength) - 1;

  if (!Number.isSafeInteger(nextValue) || nextValue < 0 || nextValue > maxValue) {
    return null;
  }

  const { minStart } = getFieldBitRange(field);
  const nextBytes = new Map<number, number>();

  for (const subfield of field.subfields) {
    const currentByte = nextBytes.has(subfield.address)
      ? nextBytes.get(subfield.address)
      : rawBytes[subfield.address];

    if (typeof currentByte !== 'number') {
      return null;
    }

    const valueMask = (1 << subfield.length) - 1;
    const sourceValue = Math.floor(nextValue / (2 ** (subfield.start - minStart))) % (2 ** subfield.length);
    const byteMask = valueMask << subfield.offset;
    const mergedValue = (currentByte & ~byteMask) | ((sourceValue << subfield.offset) & byteMask);

    nextBytes.set(subfield.address, mergedValue & 0xff);
  }

  return Array.from(nextBytes.entries())
    .map(([address, value]) => ({ address, value }))
    .sort((left, right) => left.address - right.address);
};

export const buildRohmRegisterRows = (
  registerMap: RohmRegisterMap,
  rawBytes: RohmRegisterByteMap,
  format: RegisterValueFormat
): RohmRegisterFieldRow[] =>
  registerMap.bitfields
    .map((field) => {
      const addressSpan = getFieldAddressSpan(field);
      const primaryAddress = addressSpan[0];
      const bitLength = getFieldBitLength(field);
      const resolvedField = resolveFieldValue(field, rawBytes);

      return {
        access: formatAccess(field),
        addressSpan,
        bitLength,
        description: field.doc,
        key: getRohmFieldKey(field),
        name: field.name,
        numericValue: resolvedField.value,
        primaryAddress,
        primaryAddressDec: `${primaryAddress}`,
        primaryAddressHex: formatRohmHex(primaryAddress, 2),
        rawValueText: formatFieldRawBytes(addressSpan, rawBytes),
        resolved: resolvedField.resolved,
        valueText: formatRohmFieldValue(resolvedField.value, bitLength, format),
      };
    })
    .sort((left, right) => {
      if (left.primaryAddress !== right.primaryAddress) {
        return left.primaryAddress - right.primaryAddress;
      }
      return left.name.localeCompare(right.name);
    });
