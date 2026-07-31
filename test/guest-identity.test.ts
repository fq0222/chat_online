import test from 'node:test';
import assert from 'node:assert/strict';
import { getGuestNameFromSearch } from '../apps/web/src/utils/guestIdentity';

test('从访客链接 user 查询参数读取展示名', () => {
  assert.equal(getGuestNameFromSearch('?user=fuqiang_2015%40163.com'), 'fuqiang_2015@163.com');
});

test('访客链接未携带有效 user 参数时不覆盖默认展示名', () => {
  assert.equal(getGuestNameFromSearch('?roomId=room-1'), null);
  assert.equal(getGuestNameFromSearch('?user=%20%20'), null);
});
