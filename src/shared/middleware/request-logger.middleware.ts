import { Request, Response, NextFunction } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: duration,
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.get('user-agent')
    }));
  });

  next();
}
