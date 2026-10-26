// A deliberately small XML reader for CAP and RSS/Atom feeds.
// - Namespace prefixes are dropped ("cap:alert" -> "alert").
// - DOCTYPE / external entities are ignored, so there is no entity-expansion or XXE risk.
// - Only the five predefined entities and numeric character references are decoded.
// Not a general XML parser: it is built for the well-formed feeds official alerting authorities publish.

export interface XmlNode {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  text: string // concatenated direct text (trimmed)
}

const MAX_BYTES = 5_000_000
const MAX_NODES = 200_000

export class XmlError extends Error {}

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (m, e: string) => {
    if (e === 'lt') return '<'
    if (e === 'gt') return '>'
    if (e === 'amp') return '&'
    if (e === 'quot') return '"'
    if (e === 'apos') return "'"
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
  })
}

const local = (name: string) => name.slice(name.indexOf(':') + 1)

function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const key = m[1]
    if (key === 'xmlns' || key.startsWith('xmlns:')) continue
    out[local(key)] = decode(m[3] ?? m[4] ?? '')
  }
  return out
}

export function parseXml(input: string): XmlNode {
  if (typeof input !== 'string' || !input.trim()) throw new XmlError('Empty document')
  if (input.length > MAX_BYTES) throw new XmlError('Document too large')
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([^\s>/!?]+)([^>]*?)(\/?)>|([^<]+)/g
  let m: RegExpExecArray | null
  let count = 0
  while ((m = re.exec(input))) {
    if (++count > MAX_NODES) throw new XmlError('Document too complex')
    const cur = stack[stack.length - 1]
    if (m[1] !== undefined) {
      cur.text += m[1]
    } else if (m[3] !== undefined) {
      const closing = m[2] === '/'
      const name = local(m[3])
      if (closing) {
        if (stack.length === 1 || cur.name !== name) throw new XmlError(`Mismatched closing tag </${name}>`)
        stack.pop()
      } else {
        const node: XmlNode = { name, attrs: parseAttrs(m[4] || ''), children: [], text: '' }
        cur.children.push(node)
        if (m[5] !== '/') stack.push(node)
      }
    } else if (m[6] !== undefined) {
      cur.text += decode(m[6])
    }
  }
  if (stack.length !== 1) throw new XmlError('Unclosed element')
  const top = root.children[0]
  if (!top) throw new XmlError('No root element')
  const finish = (n: XmlNode) => {
    n.text = n.text.trim()
    n.children.forEach(finish)
  }
  finish(top)
  return top
}

export const child = (n: XmlNode | undefined, name: string) => n?.children.find((c) => c.name === name)
export const childrenOf = (n: XmlNode | undefined, name: string) => n?.children.filter((c) => c.name === name) ?? []
export const textOf = (n: XmlNode | undefined, name: string) => child(n, name)?.text || ''
export function descendants(n: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of n.children) {
    if (c.name === name) out.push(c)
    descendants(c, name, out)
  }
  return out
}
