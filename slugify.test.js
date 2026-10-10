const test = require('node:test');
const assert = require('node:assert');
const { slugify } = require('./slugify');

test('strips accents and lowercases', () => {
  assert.strictEqual(slugify('Pão de Açúcar'), 'pao-de-acucar');
});

test('trims and collapses punctuation and spaces', () => {
  assert.strictEqual(slugify('  Olá, Mundo!!  '), 'ola-mundo');
});

test('collapses a run of separators into a single hyphen', () => {
  assert.strictEqual(slugify('São Paulo / SP'), 'sao-paulo-sp');
});

test('returns empty string for empty input', () => {
  assert.strictEqual(slugify(''), '');
});

test('returns empty string when there are no alphanumeric characters', () => {
  assert.strictEqual(slugify(' -- !! '), '');
});

test('keeps digits', () => {
  assert.strictEqual(slugify('Edição nº 10'), 'edicao-n-10');
});
