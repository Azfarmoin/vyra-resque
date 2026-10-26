// Free text from citizens and field reports is UNTRUSTED. Everything that reaches the UI summary or an
// AI prompt passes through here first: strip control characters, drop contact details, cap the length.

const PHONE = /(?:\+?\d[\s().-]?){7,}/g
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g

export function sanitizeText(input: unknown, max = 240): string {
  if (typeof input !== 'string') return ''
  let s = input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(EMAIL, '[email removed]')
    .replace(PHONE, '[number removed]')
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length > max) s = `${s.slice(0, max - 1).trimEnd()}…`
  return s
}
