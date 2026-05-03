import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import { appConfig } from '../../../core/config/app.config';

type ManagedProcess = 'health' | 'telemetry';

interface ProcessState {
  running: boolean;
  pid: number | null;
}

interface HttpProbe {
  ok: boolean;
  status?: number;
  payload?: unknown;
  error?: string;
}

export interface MigiStatusSnapshot {
  enabled: boolean;
  repoPath: string;
  dashboardPath: string;
  pythonCmd: string;
  ports: {
    health: number;
    telemetry: number;
  };
  processes: Record<ManagedProcess, ProcessState>;
  probes: {
    health: HttpProbe;
    readiness: HttpProbe;
    systemInfo: HttpProbe;
  };
}

export class MigiControlPlane {
  private readonly processes = new Map<ManagedProcess, ChildProcessWithoutNullStreams>();

  private repoPath(): string {
    return path.resolve(process.cwd(), appConfig.migi.repoDir);
  }

  private dashboardPath(): string {
    return path.resolve(this.repoPath(), 'memory', 'neurosemantics', 'dashboard.html');
  }

  private scriptPath(kind: ManagedProcess): string {
    const filename = kind === 'health' ? 'health.py' : 'telemetry_ws.py';
    return path.resolve(this.repoPath(), filename);
  }

  private processState(kind: ManagedProcess): ProcessState {
    const p = this.processes.get(kind);
    if (!p) return { running: false, pid: null };
    return { running: p.exitCode === null, pid: p.pid ?? null };
  }

  private guardEnabled(): void {
    if (!appConfig.migi.enabled) {
      throw new Error('MIGI control plane is disabled (set MIGI_ENABLED=true)');
    }
  }

  private ensureLayout(): void {
    const repo = this.repoPath();
    if (!fs.existsSync(repo)) {
      throw new Error(`MIGI repository not found at ${repo}`);
    }
    for (const kind of ['health', 'telemetry'] as const) {
      const script = this.scriptPath(kind);
      if (!fs.existsSync(script)) {
        throw new Error(`MIGI script missing: ${script}`);
      }
    }
  }

  private spawnProcess(kind: ManagedProcess): void {
    if (this.processState(kind).running) return;
    const script = this.scriptPath(kind);
    const env = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      ...(kind === 'health' ? { PORT: String(appConfig.migi.healthPort) } : {}),
      ...(kind === 'telemetry' ? { PORT: String(appConfig.migi.telemetryPort) } : {})
    };

    const child = spawn(appConfig.migi.pythonCmd, [script], {
      cwd: this.repoPath(),
      env,
      stdio: 'pipe'
    });

    child.stdout.on('data', (chunk) => {
      const line = String(chunk).trim();
      if (line) console.log(`[migi/${kind}] ${line}`);
    });
    child.stderr.on('data', (chunk) => {
      const line = String(chunk).trim();
      if (line) console.error(`[migi/${kind}:err] ${line}`);
    });
    child.on('exit', (code, signal) => {
      console.warn(`[migi/${kind}] exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      const active = this.processes.get(kind);
      if (active === child) this.processes.delete(kind);
    });
    child.on('error', (err) => {
      console.error(`[migi/${kind}:spawn-error] ${err.message}`);
      const active = this.processes.get(kind);
      if (active === child) this.processes.delete(kind);
    });

    this.processes.set(kind, child);
  }

  private async stopProcess(kind: ManagedProcess): Promise<void> {
    const child = this.processes.get(kind);
    if (!child) return;

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        this.processes.delete(kind);
        resolve();
      };

      child.once('exit', () => done());
      child.kill();
      setTimeout(() => {
        if (child.exitCode === null) {
          try { child.kill('SIGKILL'); } catch { /* noop */ }
        }
      }, 1500).unref();
      setTimeout(done, 2500).unref();
    });
  }

  private async probe(pathname: string): Promise<HttpProbe> {
    try {
      const url = `http://127.0.0.1:${appConfig.migi.healthPort}${pathname}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      const text = await res.text();
      let payload: unknown = text;
      try { payload = JSON.parse(text); } catch { /* plain text */ }
      return { ok: res.ok, status: res.status, payload };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async status(): Promise<MigiStatusSnapshot> {
    const probes = {
      health: await this.probe('/health'),
      readiness: await this.probe('/readiness'),
      systemInfo: await this.probe('/system/info')
    };

    return {
      enabled: appConfig.migi.enabled,
      repoPath: this.repoPath(),
      dashboardPath: this.dashboardPath(),
      pythonCmd: appConfig.migi.pythonCmd,
      ports: {
        health: appConfig.migi.healthPort,
        telemetry: appConfig.migi.telemetryPort
      },
      processes: {
        health: this.processState('health'),
        telemetry: this.processState('telemetry')
      },
      probes
    };
  }

  async start(): Promise<MigiStatusSnapshot> {
    this.guardEnabled();
    this.ensureLayout();
    this.spawnProcess('health');
    this.spawnProcess('telemetry');
    await new Promise(r => setTimeout(r, 350));
    return this.status();
  }

  async stop(): Promise<MigiStatusSnapshot> {
    await this.stopProcess('telemetry');
    await this.stopProcess('health');
    return this.status();
  }

  async restart(): Promise<MigiStatusSnapshot> {
    await this.stop();
    return this.start();
  }
}

export const migiControlPlane = new MigiControlPlane();
