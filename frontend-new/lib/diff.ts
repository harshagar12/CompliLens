/**
 * Word-level text diffing utility using Longest Common Subsequence (LCS).
 * Matches words and whitespace tokens, highlighting removed and added words
 * styled according to DESIGN.md palette (brick for removed, stamp-green for added).
 */

export interface WordDiffChunk {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export function computeWordDiff(oldText: string = "", newText: string = ""): WordDiffChunk[] {
  const sOld = (oldText ?? "").trim();
  const sNew = (newText ?? "").trim();

  // If identical, return as single unchanged chunk
  if (sOld === sNew) {
    return [{ value: sNew || "—" }];
  }

  // If one is empty
  if (!sOld) {
    return [{ value: sNew, added: true }];
  }
  if (!sNew) {
    return [{ value: sOld, removed: true }];
  }

  // Tokenize words and non-words (preserving punctuation and spacing)
  const oldTokens = sOld.match(/\S+|\s+/g) || [];
  const newTokens = sNew.match(/\S+|\s+/g) || [];

  const n = oldTokens.length;
  const m = newTokens.length;

  // LCS dynamic programming table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldTokens[i - 1].toLowerCase() === newTokens[j - 1].toLowerCase()) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to assemble diff chunks
  let i = n;
  let j = m;
  const rawDiff: WordDiffChunk[] = [];

  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      oldTokens[i - 1].toLowerCase() === newTokens[j - 1].toLowerCase()
    ) {
      rawDiff.push({ value: newTokens[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rawDiff.push({ value: newTokens[j - 1], added: true });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      rawDiff.push({ value: oldTokens[i - 1], removed: true });
      i--;
    }
  }

  rawDiff.reverse();

  // Merge adjacent tokens with the same diff status
  const merged: WordDiffChunk[] = [];
  for (const token of rawDiff) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      Boolean(prev.added) === Boolean(token.added) &&
      Boolean(prev.removed) === Boolean(token.removed)
    ) {
      prev.value += token.value;
    } else {
      merged.push({ ...token });
    }
  }

  return merged;
}
