export type DiffToken = {
  type: "equal" | "add" | "remove";
  text: string;
};

function tokenizeWords(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

/** Word-level LCS diff for readable translation comparison. */
export function diffWords(before: string, after: string): DiffToken[] {
  const a = tokenizeWords(before);
  const b = tokenizeWords(after);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array(m + 1).fill(0)
  );

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      tokens.push({ type: "equal", text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      tokens.push({ type: "remove", text: a[i] });
      i += 1;
    } else {
      tokens.push({ type: "add", text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    tokens.push({ type: "remove", text: a[i] });
    i += 1;
  }
  while (j < m) {
    tokens.push({ type: "add", text: b[j] });
    j += 1;
  }
  return mergeAdjacent(tokens);
}

function mergeAdjacent(tokens: DiffToken[]): DiffToken[] {
  const out: DiffToken[] = [];
  for (const token of tokens) {
    const last = out[out.length - 1];
    if (last && last.type === token.type) {
      last.text += token.text;
    } else {
      out.push({ ...token });
    }
  }
  return out;
}

export function summarizeDiff(tokens: DiffToken[]) {
  let added = 0;
  let removed = 0;
  for (const t of tokens) {
    if (t.type === "add") added += t.text.trim() ? 1 : 0;
    if (t.type === "remove") removed += t.text.trim() ? 1 : 0;
  }
  return { added, removed, changed: added + removed > 0 };
}
