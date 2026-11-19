/**
 * The admin e2e teardown queues the account-erasure step by its number (e2e/support/local-stack.ts
 * keeps its imports local): it must stay the shared enum's value.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessageType } from '@al-ummah/shared-types';
import { USER_DATA_ERASED } from '../e2e/support/local-stack';

test('USER_DATA_ERASED is MessageType.UserDataErased', () => {
  assert.equal(USER_DATA_ERASED, MessageType.UserDataErased);
});
