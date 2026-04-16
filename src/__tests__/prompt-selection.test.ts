import { describe, it, expect } from 'vitest';
import { parseSelection } from '../utils/prompt.js';

describe('parseSelection', () => {
  it('parses single number', () => {
    expect(parseSelection('1', 5)).toEqual([0]);
    expect(parseSelection('3', 5)).toEqual([2]);
    expect(parseSelection('5', 5)).toEqual([4]);
  });

  it('parses comma-separated numbers', () => {
    expect(parseSelection('1,3', 5)).toEqual([0, 2]);
    expect(parseSelection('1,3,5', 5)).toEqual([0, 2, 4]);
  });

  it('parses ranges', () => {
    expect(parseSelection('1-3', 5)).toEqual([0, 1, 2]);
    expect(parseSelection('2-4', 5)).toEqual([1, 2, 3]);
  });

  it('parses mixed ranges and singles', () => {
    expect(parseSelection('1-3,5', 5)).toEqual([0, 1, 2, 4]);
    expect(parseSelection('1,3-5', 5)).toEqual([0, 2, 3, 4]);
  });

  it('deduplicates overlapping selections', () => {
    expect(parseSelection('1,1,2', 5)).toEqual([0, 1]);
    expect(parseSelection('1-3,2-4', 5)).toEqual([0, 1, 2, 3]);
  });

  it('handles whitespace around numbers', () => {
    expect(parseSelection(' 1 , 3 ', 5)).toEqual([0, 2]);
    expect(parseSelection('1 - 3', 5)).toEqual([0, 1, 2]);
  });

  it('returns null for out-of-range numbers', () => {
    expect(parseSelection('0', 5)).toBeNull();
    expect(parseSelection('6', 5)).toBeNull();
    expect(parseSelection('99', 5)).toBeNull();
  });

  it('returns null for out-of-range ranges', () => {
    expect(parseSelection('0-3', 5)).toBeNull();
    expect(parseSelection('3-6', 5)).toBeNull();
  });

  it('returns null for reversed ranges', () => {
    expect(parseSelection('3-1', 5)).toBeNull();
  });

  it('returns null for invalid input', () => {
    expect(parseSelection('abc', 5)).toBeNull();
    expect(parseSelection('1,abc', 5)).toBeNull();
    expect(parseSelection('1.5', 5)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseSelection('', 5)).toBeNull();
  });

  it('returns sorted indices', () => {
    expect(parseSelection('3,1,5', 5)).toEqual([0, 2, 4]);
  });

  it('handles single item maxItems', () => {
    expect(parseSelection('1', 1)).toEqual([0]);
    expect(parseSelection('2', 1)).toBeNull();
  });
});
