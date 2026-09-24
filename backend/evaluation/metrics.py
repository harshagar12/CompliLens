"""
Evaluation metrics calculation module for CompliLens (PRD §7).
Computes:
- CER (Character Error Rate)
- WER (Word Error Rate)
- Per-field extraction Precision, Recall, F1
- End-to-end Compliance Accuracy, Precision, Recall, and False-Compliance Rate
"""
from __future__ import annotations
from typing import Sequence


def levenshtein_distance(seq1: Sequence, seq2: Sequence) -> int:
    """Computes standard edit distance between two sequences (characters or words)."""
    m, n = len(seq1), len(seq2)
    dp = [[0] * (n + 1) for _ in range(m + 1)]

    for i in range(m + 1):
        dp[i][0] = i
    for j in range(n + 1):
        dp[0][j] = j

    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if seq1[i - 1] == seq2[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])

    return dp[m][n]


def compute_cer(reference: str, hypothesis: str) -> float:
    """Character Error Rate = edit_distance(chars) / len(reference_chars)."""
    ref_clean = reference.strip()
    hyp_clean = hypothesis.strip()
    if not ref_clean:
        return 0.0 if not hyp_clean else 1.0
    dist = levenshtein_distance(ref_clean, hyp_clean)
    return float(dist) / len(ref_clean)


def compute_wer(reference: str, hypothesis: str) -> float:
    """Word Error Rate = edit_distance(words) / len(reference_words)."""
    ref_words = reference.strip().split()
    hyp_words = hypothesis.strip().split()
    if not ref_words:
        return 0.0 if not hyp_words else 1.0
    dist = levenshtein_distance(ref_words, hyp_words)
    return float(dist) / len(ref_words)


def compute_prf1(tp: int, fp: int, fn: int) -> dict[str, float]:
    """Computes Precision, Recall, and F1 score."""
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0
    return {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
    }


def compute_compliance_classification_metrics(
    gt_results: list[str],
    pred_results: list[str],
) -> dict[str, float]:
    """
    Computes compliance metrics against confirmed_value (PRD §7):
    - Accuracy
    - False-compliance rate: (count of PASS where ground truth is FAIL) / (total ground truth FAIL cases)
    """
    assert len(gt_results) == len(pred_results)
    total = len(gt_results)
    if total == 0:
        return {"accuracy": 0.0, "false_compliance_rate": 0.0}

    correct = sum(1 for g, p in zip(gt_results, pred_results) if g == p)
    accuracy = correct / total

    # Safety-critical metric: False compliance (PASS given when actual is FAIL)
    gt_fail_count = sum(1 for g in gt_results if g == "FAIL")
    false_pass_count = sum(1 for g, p in zip(gt_results, pred_results) if g == "FAIL" and p == "PASS")

    false_compliance_rate = (false_pass_count / gt_fail_count) if gt_fail_count > 0 else 0.0

    return {
        "total_evaluated": total,
        "accuracy": round(accuracy, 4),
        "gt_fail_count": gt_fail_count,
        "false_pass_count": false_pass_count,
        "false_compliance_rate": round(false_compliance_rate, 4),
    }
