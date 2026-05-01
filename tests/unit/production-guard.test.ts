/**
 * Sprint VIII — production safety guard.
 * ALLOW_ANONYMOUS=true w prod = krytyczna luka. createApp() musi rzucić.
 */

describe('production safety guard', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalAnon = process.env.ALLOW_ANONYMOUS;
  const originalCors = process.env.CORS_ORIGIN;
  const originalOverride = process.env.SECURITY_OVERRIDE;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    process.env.ALLOW_ANONYMOUS = originalAnon;
    process.env.CORS_ORIGIN = originalCors;
    process.env.SECURITY_OVERRIDE = originalOverride;
    jest.resetModules();
  });

  it('rzuca FATAL gdy NODE_ENV=production + ALLOW_ANONYMOUS=true bez SECURITY_OVERRIDE', async () => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_ANONYMOUS = 'true';
    process.env.CORS_ORIGIN = 'https://example.com';
    delete process.env.SECURITY_OVERRIDE;

    const { createApp } = await import('../../src/app');
    expect(() => createApp()).toThrow(/ALLOW_ANONYMOUS=true is forbidden in production/);
  });

  it('rzuca FATAL gdy NODE_ENV=production + CORS_ORIGIN=*', async () => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_ANONYMOUS = 'false';
    process.env.CORS_ORIGIN = '*';

    const { createApp } = await import('../../src/app');
    expect(() => createApp()).toThrow(/CORS_ORIGIN=\* is forbidden in production/);
  });

  it('przepuszcza prod gdy ALLOW_ANONYMOUS=false i CORS_ORIGIN explicit', async () => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_ANONYMOUS = 'false';
    process.env.CORS_ORIGIN = 'https://mtaquestwebsidex.app';

    const { createApp } = await import('../../src/app');
    expect(() => createApp()).not.toThrow();
  });

  it('respektuje SECURITY_OVERRIDE dla świadomego demo w prod', async () => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_ANONYMOUS = 'true';
    process.env.CORS_ORIGIN = 'https://demo.example.com';
    process.env.SECURITY_OVERRIDE = 'allow_anonymous_in_prod';

    const { createApp } = await import('../../src/app');
    expect(() => createApp()).not.toThrow();
  });
});
