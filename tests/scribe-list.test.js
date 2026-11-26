import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spokenList, scribeMessages } from '../src/lib/scribe-llm.js';

// The shape that asked for the feature: a bartender calling a bottle count, brand + amount, back to back.
const BAR_COUNT = "Tito's zero point 8, Makers point 4, Espilan two, Jameson 3 quarters, Bacardi one.";

test('a spoken bottle count reads as a list, amounts normalized to digits', () => {
  assert.deepEqual(spokenList(BAR_COUNT), [
    { item: "Tito's", amount: 0.8 },
    { item: 'Makers', amount: 0.4 },
    { item: 'Espilan', amount: 2 },
    { item: 'Jameson', amount: 0.75 },
    { item: 'Bacardi', amount: 1 },
  ]);
});

test('a shopping run reads as a list, and the ask is not part of the first item', () => {
  assert.deepEqual(spokenList('I need 2 eggs, 3 apples and 12 bagels'), [
    { item: 'eggs', amount: 2 },
    { item: 'apples', amount: 3 },
    { item: 'bagels', amount: 12 },
  ]);
});

test('compound and decimal number words parse', () => {
  assert.deepEqual(spokenList('bolts twenty five, washers two point five, screws one half'), [
    { item: 'bolts', amount: 25 },
    { item: 'washers', amount: 2.5 },
    { item: 'screws', amount: 0.5 },
  ]);
});

test('work talk with numbers in it is not a list', () => {
  // Imperative opener: instructions, however many numbers they carry.
  assert.equal(spokenList('Fix the 2 failing tests, then update 3 docs and ship version 2'), null);
  // Numbers mentioned inside ordinary sentences: too little of the speech is items and amounts.
  assert.equal(spokenList('The deploy takes 5 minutes and the cache invalidation bug from 2 weeks ago is back'), null);
  // Only two pairs: not a list yet.
  assert.equal(spokenList('eggs 2, milk 1'), null);
  // A clause is not an item name.
  assert.equal(spokenList('the stuff we ordered last week for the office kitchen 4, chairs 2, desks 3'), null);
});

test('scribeMessages hands a counted list to the model as one list', () => {
  const messages = scribeMessages({ project: 'bar', tickets: [], earlier: '', speech: BAR_COUNT });
  const user = messages.at(-1).content;
  assert.match(user, /spoken list, counted by the app/);
  assert.match(user, /- Tito's — 0\.8/);
  assert.match(user, /- Jameson — 0\.75/);
  assert.match(user, /- Bacardi — 1/);
  assert.match(user, /ONE create for the whole list/);
});

test('scribeMessages leaves ordinary speech unannotated', () => {
  const messages = scribeMessages({ project: '', tickets: [], earlier: '', speech: 'Add a dark mode toggle to the settings page' });
  assert.doesNotMatch(messages.at(-1).content, /spoken list/);
});
