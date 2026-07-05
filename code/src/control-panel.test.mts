import { describe, expect, it } from 'vitest';
import { PAGE_HTML, parseCompanyNames } from './control-panel.mjs';

// The control panel serves its client-side JS inside a template-literal HTML
// string. A stray `\n` (or other escape) there becomes a real character in the
// served page and breaks the inline <script> at parse time — which curl-based
// API tests can't catch. These tests guard the served page itself.
describe('control panel served HTML', () => {
  const scriptMatch = PAGE_HTML.match(/<script>([\s\S]*?)<\/script>/);

  it('contains an inline <script>', () => {
    expect(scriptMatch).not.toBeNull();
  });

  it('serves syntactically valid client JavaScript', () => {
    const script = scriptMatch?.[1] ?? '';
    // new Function() compiles the body (throws on a syntax error) without
    // executing it, so DOM/fetch references are fine. This is exactly what a
    // stray `\n` in the template literal broke — a raw newline inside a JS
    // string literal is an "unterminated string" SyntaxError.
    expect(() => new Function(script)).not.toThrow();
  });
});

describe('parseCompanyNames', () => {
  it('extracts company names from the <DATA><ROW><F01> shape', () => {
    const xml =
      '<DATA><ROW><F01>Arihant Daga EXP</F01></ROW><ROW><F01>Other Co</F01></ROW></DATA>';
    expect(parseCompanyNames(xml)).toEqual(['Arihant Daga EXP', 'Other Co']);
  });

  it('returns an empty array when there are no rows', () => {
    expect(parseCompanyNames('<DATA></DATA>')).toEqual([]);
  });
});
