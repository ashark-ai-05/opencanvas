import { collapse, toNumber } from './common';

type Dim = 'length' | 'mass' | 'volume' | 'speed' | 'temp';
type Unit = { dim: Dim; factor: number; label: string };

/** Canonical units. `factor` converts to the dimension's base unit. */
const UNITS: Record<string, Unit> = {
  mm: { dim: 'length', factor: 0.001, label: 'mm' },
  cm: { dim: 'length', factor: 0.01, label: 'cm' },
  m: { dim: 'length', factor: 1, label: 'm' },
  km: { dim: 'length', factor: 1000, label: 'km' },
  in: { dim: 'length', factor: 0.0254, label: 'in' },
  ft: { dim: 'length', factor: 0.3048, label: 'ft' },
  yd: { dim: 'length', factor: 0.9144, label: 'yd' },
  mi: { dim: 'length', factor: 1609.344, label: 'mi' },
  g: { dim: 'mass', factor: 0.001, label: 'g' },
  kg: { dim: 'mass', factor: 1, label: 'kg' },
  lb: { dim: 'mass', factor: 0.45359237, label: 'lb' },
  oz: { dim: 'mass', factor: 0.028349523, label: 'oz' },
  ml: { dim: 'volume', factor: 0.001, label: 'ml' },
  l: { dim: 'volume', factor: 1, label: 'L' },
  gal: { dim: 'volume', factor: 3.785411784, label: 'gal' },
  cup: { dim: 'volume', factor: 0.2365882365, label: 'cup' },
  kph: { dim: 'speed', factor: 1000 / 3600, label: 'km/h' },
  mph: { dim: 'speed', factor: 1609.344 / 3600, label: 'mph' },
  c: { dim: 'temp', factor: 1, label: '°C' },
  f: { dim: 'temp', factor: 1, label: '°F' },
  k: { dim: 'temp', factor: 1, label: 'K' },
};

const ALIASES: Record<string, string> = {
  millimeter: 'mm', millimeters: 'mm', millimetre: 'mm', millimetres: 'mm',
  centimeter: 'cm', centimeters: 'cm', centimetre: 'cm', centimetres: 'cm',
  meter: 'm', meters: 'm', metre: 'm', metres: 'm',
  kilometer: 'km', kilometers: 'km', kilometre: 'km', kilometres: 'km', kms: 'km',
  inch: 'in', inches: 'in', foot: 'ft', feet: 'ft', yard: 'yd', yards: 'yd',
  mile: 'mi', miles: 'mi',
  gram: 'g', grams: 'g', kilogram: 'kg', kilograms: 'kg', kilo: 'kg', kilos: 'kg', kgs: 'kg',
  pound: 'lb', pounds: 'lb', lbs: 'lb', ounce: 'oz', ounces: 'oz',
  milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  gallon: 'gal', gallons: 'gal', cups: 'cup',
  'km/h': 'kph', kmh: 'kph', kmph: 'kph',
  celsius: 'c', '°c': 'c', fahrenheit: 'f', '°f': 'f', kelvin: 'k',
};

function unit(raw: string): string | null {
  const key = raw.toLowerCase();
  if (UNITS[key]) return key;
  const alias = ALIASES[key];
  return alias && UNITS[alias] ? alias : null;
}

export type ConvertData = {
  value: number;
  from: string;
  to: string;
  result: number | null;
  expression: string;
};

function temp(value: number, from: string, to: string): number {
  const c =
    from === 'c' ? value : from === 'f' ? ((value - 32) * 5) / 9 : value - 273.15;
  return to === 'c' ? c : to === 'f' ? (c * 9) / 5 + 32 : c + 273.15;
}

/** Returns null when either unit is unknown or the dimensions differ. */
export function convertValue(value: number, from: string, to: string): number | null {
  const a = UNITS[from];
  const b = UNITS[to];
  if (!a || !b || a.dim !== b.dim) return null;
  if (a.dim === 'temp') return temp(value, from, to);
  return (value * a.factor) / b.factor;
}

const RE =
  /(\d[\d,]*(?:\.\d+)?)\s*°?\s*([a-z°/]+)\s+(?:to|in|into|as)\s+°?\s*([a-z°/]+)\b/i;

export function parseConvert(text: string): ConvertData | null {
  const t = collapse(text).toLowerCase().replace(/[?]+\s*$/, '');
  const m = t.match(RE);
  if (!m) return null;
  const from = unit(m[2]);
  const to = unit(m[3]);
  if (!from || !to) return null;
  const value = toNumber(m[1]);
  const result = convertValue(value, from, to);
  if (result === null) return null;
  return {
    value,
    from,
    to,
    result,
    expression: `${m[1]} ${UNITS[from].label} → ${UNITS[to].label}`,
  };
}

export function unitLabel(key: string): string {
  return UNITS[key]?.label ?? key;
}
