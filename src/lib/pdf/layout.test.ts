import { describe, expect, it } from 'vitest'
import { sanitizeFileName, sniff } from '../files'
import { createMapper, placeImage } from './layout'
import { chunkRanges, parseRanges } from './ranges'

describe('parseRanges', () => {
  it('parses single pages, ranges and open ends into 0-based groups', () => {
    expect(parseRanges('1-3, 5, 8-', 9)).toEqual([[0, 1, 2], [4], [7, 8]])
    expect(parseRanges(' 2 ; -2 ', 4)).toEqual([[1], [0, 1]])
  })
  it('rejects invalid input with readable errors', () => {
    expect(() => parseRanges('', 3)).toThrow(/at least one/)
    expect(() => parseRanges('0-2', 3)).toThrow(/outside/)
    expect(() => parseRanges('4', 3)).toThrow(/outside/)
    expect(() => parseRanges('3-1', 3)).toThrow(/start is after end/)
    expect(() => parseRanges('a-b', 3)).toThrow(/not a valid range/)
  })
  it('chunks every N pages', () => {
    expect(chunkRanges(5, 2)).toEqual([[0, 1], [2, 3], [4]])
  })
})

describe('placeImage', () => {
  it('fits and centres on A4 portrait / landscape', () => {
    const p = placeImage(1000, 1000, 'a4', 'portrait')
    expect(p.pageWidth).toBeCloseTo(595.28)
    expect(p.image.w).toBeCloseTo(595.28)
    expect(p.image.y).toBeCloseTo((841.89 - 595.28) / 2)
    const l = placeImage(2000, 1000, 'letter', 'auto')
    expect(l.pageWidth).toBe(792) // landscape image -> landscape page
  })
  it('auto size matches the image aspect ratio', () => {
    const p = placeImage(800, 1200, 'auto', 'auto')
    expect(p.pageHeight / p.pageWidth).toBeCloseTo(1.5)
    expect(p.image).toEqual({ x: 0, y: 0, w: p.pageWidth, h: p.pageHeight })
  })
})

describe('createMapper', () => {
  const box = { x: 10, y: 20, w: 100, h: 200 }
  it('maps display corners for every rotation', () => {
    // top-left of what the viewer shows
    expect(createMapper(box, 0).map(0, 0)).toEqual({ x: 10, y: 220 })
    expect(createMapper(box, 90).map(0, 0)).toEqual({ x: 10, y: 20 })
    expect(createMapper(box, 180).map(0, 0)).toEqual({ x: 110, y: 20 })
    expect(createMapper(box, 270).map(0, 0)).toEqual({ x: 110, y: 220 })
    expect(createMapper(box, 90).dispW).toBe(200)
  })
})

describe('file checks', () => {
  it('sniffs real types from magic bytes', () => {
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg')
    expect(sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('png')
    expect(sniff(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp')
    expect(sniff(new TextEncoder().encode('%PDF-1.7'))).toBe('pdf')
    expect(sniff(new TextEncoder().encode('hello world'))).toBe(null)
  })
  it('sanitizes file names', () => {
    expect(sanitizeFileName('  ../a:b*c?.pdf ', 'x')).toBe('_a_b_c_')
    expect(sanitizeFileName('Račun 2026', 'x')).toBe('Račun 2026')
    expect(sanitizeFileName('', 'fallback')).toBe('fallback')
  })
})
