/**
 * Sprint VIII — WS handshake auth + room ownership guard.
 */
import { canJoinRoom, SocketUser } from '../../src/shared/middleware/socket-auth.middleware';

describe('socket-auth: canJoinRoom', () => {
  it('odrzuca undefined user', () => {
    expect(canJoinRoom(undefined, 'session-x')).toBe(false);
  });

  it('admin może wszystko', () => {
    const u: SocketUser = { uid: 'u1', anonymous: false, role: 'admin' };
    expect(canJoinRoom(u, 'cudza-sesja')).toBe(true);
    expect(canJoinRoom(u, 'inny-uid')).toBe(true);
  });

  it('system może wszystko', () => {
    const u: SocketUser = { uid: 'sys', anonymous: false, role: 'system' };
    expect(canJoinRoom(u, 'cokolwiek')).toBe(true);
  });

  it('user może tylko swoje sessionId', () => {
    const u: SocketUser = { uid: 'u1', anonymous: false, role: 'user' };
    expect(canJoinRoom(u, 'u1')).toBe(true);
    expect(canJoinRoom(u, 'u1:branch-a')).toBe(true);
    expect(canJoinRoom(u, 'u2')).toBe(false);
    expect(canJoinRoom(u, 'u2:branch-x')).toBe(false);
  });

  it('anonim też podlega regułom (uid="anonymous" → tylko "anonymous")', () => {
    const u: SocketUser = { uid: 'anonymous', anonymous: true, role: 'user' };
    expect(canJoinRoom(u, 'anonymous')).toBe(true);
    expect(canJoinRoom(u, 'anonymous:x')).toBe(true);
    expect(canJoinRoom(u, 'real-user')).toBe(false);
  });

  it('puste sessionId = false', () => {
    const u: SocketUser = { uid: 'u1', anonymous: false, role: 'user' };
    expect(canJoinRoom(u, '')).toBe(false);
  });
});
