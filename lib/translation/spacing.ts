/** A run of words between two HTML tags, split into its spacing and the words to translate. */
export type TextNode = { index: number; leading: string; core: string; trailing: string };

const BLOCK_TAG = /^<\/?(?:p|div|h[1-6]|li|ul|ol|blockquote|section|article|header|footer|tr|td|th|table|br|hr|img)\b/i;
const WORD_CHAR = /[\p{L}\p{N}]/u;

function isWord(ch: string | undefined) {
  return Boolean(ch) && WORD_CHAR.test(ch as string);
}

/** Split HTML at its tags and pick out the text runs that hold words. */
export function textNodes(parts: string[], hasWords: (core: string) => boolean): TextNode[] {
  const nodes: TextNode[] = [];
  parts.forEach((part, index) => {
    if (!part || part.startsWith("<")) return;
    const leading = part.match(/^\s*/)?.[0] ?? "";
    const trailing = part.match(/\s*$/)?.[0] ?? "";
    const core = part.slice(leading.length, part.length - trailing.length);
    if (!core || !hasWords(core)) return;
    nodes.push({ index, leading, core, trailing });
  });
  return nodes;
}

/**
 * Put a space back where translated runs would run together.
 *
 * `<strong>MR.DIY</strong>’s Bersama Satu Bazaar` is two runs. The source joins them
 * at an apostrophe, but "’s Bersama Satu Bazaar" may come back as "Bazar Bersama Satu",
 * which would print "MR.DIYBazar". Runs the source itself joins letter to letter are left alone.
 */
export function keepWordGaps(parts: string[], nodes: TextNode[], values: string[]): string[] {
  const out = [...values];
  for (let at = 1; at < nodes.length; at += 1) {
    const previous = nodes[at - 1];
    const current = nodes[at];
    if (previous.trailing || current.leading) continue;
    const between = parts.slice(previous.index + 1, current.index);
    // Only inline tags such as <strong> or <a> sit between the runs.
    if (between.some((part) => part && (!part.startsWith("<") || BLOCK_TAG.test(part)))) continue;
    const left = out[at - 1] ?? "";
    const right = out[at] ?? "";
    if (/\s$/.test(left) || /^\s/.test(right)) continue;
    const joinedInSource = isWord(previous.core[previous.core.length - 1]) && isWord(current.core[0]);
    if (!joinedInSource && isWord(left[left.length - 1]) && isWord(right[0])) {
      out[at] = ` ${right}`;
    }
  }
  return out;
}
