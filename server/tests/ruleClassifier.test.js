import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWithRules } from '../src/ai/ruleClassifier.js';

const cases = [
  ["I haven't received any royalty for 6 months", 'royalty_payments', 'critical'],
  ['ISBN on Amazon is different from the physical copy', 'isbn_metadata', 'high'],
  ['Author copies have blurry images and misaligned pages', 'printing_quality', 'high'],
  ['My book shows Currently Unavailable on Amazon', 'distribution_availability', 'high'],
  ['It has been 3 weeks and my book is still in typesetting', 'book_status_production', 'medium'],
];

for (const [text, category, priority] of cases) {
  test(`rules: "${text}"`, () => {
    const r = classifyWithRules({ subject: text, description: text });
    assert.equal(r.category, category);
    assert.equal(r.priority, priority);
  });
}

test('rules: bio update is low priority', () => {
  assert.equal(classifyWithRules({ subject: 'Can I update my author bio?', description: 'How do I change it?' }).priority, 'low');
});
