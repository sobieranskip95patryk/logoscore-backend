/**
 * Sprint VIII — RBAC + ownership unit tests.
 */
import { Request, Response } from 'express';
import { requireRole, requireAuthenticated } from '../../src/shared/middleware/rbac.middleware';
import { requireOwnership } from '../../src/shared/middleware/ownership.middleware';
import { AuthenticatedRequest } from '../../src/shared/middleware/auth.middleware';

function mockRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('rbac.middleware: requireRole', () => {
  it('401 gdy brak req.user', () => {
    const req = {} as AuthenticatedRequest;
    const res = mockRes();
    const next = jest.fn();
    requireRole('admin')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('403 gdy rola nie pasuje', () => {
    const req = { user: { uid: 'u1', anonymous: false, role: 'user' } } as AuthenticatedRequest;
    const res = mockRes();
    const next = jest.fn();
    requireRole('admin')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('przepuszcza gdy rola pasuje', () => {
    const req = { user: { uid: 'u1', anonymous: false, role: 'admin' } } as AuthenticatedRequest;
    const res = mockRes();
    const next = jest.fn();
    requireRole('admin', 'system')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('rbac.middleware: requireAuthenticated', () => {
  it('401 dla anonima', () => {
    const req = { user: { uid: 'anonymous', anonymous: true, role: 'user' } } as AuthenticatedRequest;
    const res = mockRes();
    const next = jest.fn();
    requireAuthenticated(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('przepuszcza zweryfikowanego', () => {
    const req = { user: { uid: 'u1', anonymous: false, role: 'user' } } as AuthenticatedRequest;
    const res = mockRes();
    const next = jest.fn();
    requireAuthenticated(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('ownership.middleware: requireOwnership', () => {
  it('przepuszcza admina niezależnie od pola', () => {
    const req = {
      user: { uid: 'u1', anonymous: false, role: 'admin' },
      body: { sessionId: 'someone-else' }
    } as unknown as AuthenticatedRequest;
    const res = mockRes();
    const next = jest.fn();
    requireOwnership('body', 'sessionId')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('403 gdy pole != uid', () => {
    const req = {
      user: { uid: 'u1', anonymous: false, role: 'user' },
      body: { sessionId: 'u2' }
    } as unknown as AuthenticatedRequest;
    const res = mockRes();
    const next = jest.fn();
    requireOwnership('body', 'sessionId')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('przepuszcza gdy pole === uid', () => {
    const req = {
      user: { uid: 'u1', anonymous: false, role: 'user' },
      body: { sessionId: 'u1' }
    } as unknown as AuthenticatedRequest;
    const res = mockRes();
    const next = jest.fn();
    requireOwnership('body', 'sessionId')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('przepuszcza gdy brak pola (fallback domyślny)', () => {
    const req = {
      user: { uid: 'u1', anonymous: false, role: 'user' },
      body: {}
    } as unknown as AuthenticatedRequest;
    const res = mockRes();
    const next = jest.fn();
    requireOwnership('body', 'sessionId')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('401 gdy brak req.user', () => {
    const req = { body: { sessionId: 'x' } } as unknown as AuthenticatedRequest;
    const res = mockRes();
    const next = jest.fn();
    requireOwnership('body', 'sessionId')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
