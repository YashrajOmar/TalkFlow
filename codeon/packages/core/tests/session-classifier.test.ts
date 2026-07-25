import { describe, it, expect } from 'vitest';
import { classifySession } from '../src/session-classifier.js';

describe('SessionClassifier', () => {
  it('classifies LeetCode URL as problem mode', () => {
    const result = classifySession({
      language: 'cpp',
      problemUrl: 'https://leetcode.com/problems/two-sum/',
    });
    expect(result.mode).toBe('problem');
    expect(result.detectedProblemSource).toBe('leetcode');
    expect(result.detectedProblemId).toBe('two-sum');
    expect(result.confidence).toBe('high');
  });

  it('classifies Codeforces URL as problem mode', () => {
    const result = classifySession({
      language: 'cpp',
      problemUrl: 'https://codeforces.com/problemset/problem/1234/A',
    });
    expect(result.mode).toBe('problem');
    expect(result.detectedProblemSource).toBe('codeforces');
    expect(result.confidence).toBe('high');
  });

  it('classifies AtCoder URL correctly', () => {
    const result = classifySession({
      language: 'cpp',
      problemUrl: 'https://atcoder.jp/contests/abc100/tasks/abc100_a',
    });
    expect(result.mode).toBe('problem');
    expect(result.detectedProblemSource).toBe('atcoder');
    expect(result.detectedProblemId).toBe('abc100/abc100_a');
  });

  it('defaults to scratchpad when no URL or problem provided', () => {
    const result = classifySession({ language: 'python3' });
    expect(result.mode).toBe('scratchpad');
    expect(result.detectedProblemId).toBeNull();
    expect(result.confidence).toBe('high');
  });

  it('respects explicit mode override', () => {
    const result = classifySession({
      language: 'java',
      problemUrl: 'https://leetcode.com/problems/two-sum/',
      explicitMode: 'interview',
    });
    expect(result.mode).toBe('interview');
    expect(result.confidence).toBe('high');
  });

  it('detects custom problem text with enough keywords', () => {
    const problemText = `
      Given an array of integers...
      Input: First line contains n integers
      Output: Print the answer
      Constraints: 1 <= n <= 10^5
      Example: Input: 1 2 3, Output: 6
      Note: The array may contain duplicates
    `;
    const result = classifySession({
      language: 'cpp',
      customProblemText: problemText,
    });
    expect(result.mode).toBe('problem');
    expect(result.detectedProblemSource).toBe('custom');
  });

  it('pre-resolved problem ID takes priority over URL detection', () => {
    const result = classifySession({
      language: 'cpp',
      problemId: 'p-12345',
    });
    expect(result.mode).toBe('problem');
    expect(result.detectedProblemId).toBe('p-12345');
    expect(result.confidence).toBe('high');
  });
});
