import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { join, resolve } from 'node:path';

import { FAKE_TOKEN, FakeDevice, type FakeModel } from '../../../../test/support/fake-device';

// One verification instance: three fake devices on localhost UDP, a Homebridge with this plugin
// on its own storage dir and HAP port, and a control server for the fakes.
// Started by up.sh with VERIFY_RUN_DIR set. SIGTERM stops Homebridge, then the fakes.

const REPO = resolve(__dirname, '../../../..');
const RUN_DIR = process.env.VERIFY_RUN_DIR;
if (!RUN_DIR) {
  throw new Error('VERIFY_RUN_DIR is not set');
}
const HB_DIR = join(RUN_DIR, 'hb');
const PIN = '031-45-154';

const FAKES: Array<{ id: string; name: string; model: FakeModel; moveSwitches?: boolean }> = [
  { id: 'fan-za1', name: 'Fan ZA1', model: 'zhimi.fan.za1', moveSwitches: true },
  { id: 'fan-p33', name: 'Fan P33', model: 'dmaker.fan.p33', moveSwitches: true },
  { id: 'humidifier', name: 'Humidifier', model: 'zhimi.humidifier.ca4' },
];

const freePort = (): Promise<number> =>
  new Promise((done, fail) => {
    const server = createNetServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });

const body = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const stateOf = (device: FakeDevice): Record<string, unknown> => ({
  model: device.model,
  port: device.port,
  silent: device.silent,
  props:
    device.model === 'zhimi.fan.za1'
      ? device.legacy
      : device.model === 'dmaker.fan.p33'
        ? device.miot
        : device.humidifier,
  moves: device.moves,
  requestCount: device.requests.length,
});

async function main(): Promise<void> {
  mkdirSync(HB_DIR, { recursive: true });
  const log = createWriteStream(join(RUN_DIR as string, 'homebridge.log'), { flags: 'a' });

  const devices = new Map<string, FakeDevice>();
  for (const fake of FAKES) {
    devices.set(fake.id, await FakeDevice.start(fake.model));
  }

  const bridgePort = await freePort();
  const controlPort = await freePort();
  const username = [...randomBytes(6)]
    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
  const runId = (RUN_DIR as string).split('/').pop() as string;
  writeFileSync(
    join(HB_DIR, 'config.json'),
    `${JSON.stringify(
      {
        bridge: { name: `Miio Verify ${runId}`, username, port: bridgePort, pin: PIN },
        platforms: [
          {
            platform: 'MiioLocal',
            devices: FAKES.map((fake) => ({
              name: fake.name,
              address: '127.0.0.1',
              port: devices.get(fake.id)?.port,
              token: FAKE_TOKEN,
              pollInterval: 2,
              ...(fake.moveSwitches ? { moveSwitches: true } : {}),
            })),
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  let homebridge: ChildProcess | undefined;
  const startHomebridge = (): void => {
    log.write(`--- rig: starting homebridge ${new Date().toISOString()}\n`);
    homebridge = spawn(
      process.execPath,
      [
        join(REPO, 'node_modules/homebridge/bin/homebridge'),
        '-I',
        '-Q',
        '-D',
        '-U',
        HB_DIR,
        '-P',
        REPO,
        '--strict-plugin-resolution',
      ],
      { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    homebridge.stdout?.pipe(log, { end: false });
    homebridge.stderr?.pipe(log, { end: false });
  };
  const stopHomebridge = (): Promise<void> =>
    new Promise((done) => {
      const child = homebridge;
      homebridge = undefined;
      if (!child || child.exitCode !== null) {
        done();
        return;
      }
      child.once('exit', () => done());
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
    });

  // Ready means HAP lists every configured accessory, not only that the port answers.
  const ready = async (timeoutMs: number): Promise<boolean> => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      try {
        const reply = await fetch(`http://127.0.0.1:${bridgePort}/accessories`);
        const { accessories } = (await reply.json()) as { accessories: unknown[] };
        // The bridge itself is accessory 1.
        if (accessories.length === FAKES.length + 1) {
          return true;
        }
      } catch {
        // Not listening yet.
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  };

  const control = createServer(async (request, response) => {
    const reply = (status: number, data: unknown): void => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(`${JSON.stringify(data, null, 2)}\n`);
    };
    try {
      const [, kind, id] = (request.url ?? '/').split('?')[0]?.split('/') ?? [];
      if (request.method === 'GET' && kind === 'state') {
        reply(200, {
          runId,
          fakes: Object.fromEntries([...devices].map(([k, d]) => [k, stateOf(d)])),
        });
        return;
      }
      if (kind === 'fake' && id && devices.has(id)) {
        const device = devices.get(id) as FakeDevice;
        if (request.method === 'GET') {
          reply(200, { ...stateOf(device), requests: device.requests });
          return;
        }
        if (request.method === 'POST') {
          const change = (await body(request)) as {
            set?: Record<string, string | number | boolean>;
            silent?: boolean;
            model?: FakeModel;
          };
          const props = stateOf(device).props as Record<string, string | number | boolean>;
          Object.assign(props, change.set ?? {});
          if (change.silent !== undefined) {
            device.silent = change.silent;
          }
          if (change.model) {
            device.model = change.model;
          }
          reply(200, stateOf(device));
          return;
        }
      }
      if (request.method === 'POST' && kind === 'restart') {
        await stopHomebridge();
        startHomebridge();
        reply((await ready(60_000)) ? 200 : 504, { restarted: true });
        return;
      }
      reply(404, { error: 'unknown route' });
    } catch (error) {
      reply(500, { error: String(error) });
    }
  });
  await new Promise<void>((done) => control.listen(controlPort, '127.0.0.1', done));

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    await stopHomebridge();
    control.close();
    await Promise.all([...devices.values()].map((device) => device.close()));
    log.end();
    rmSync(join(RUN_DIR as string, 'rig.json'), { force: true });
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  startHomebridge();
  const ok = await ready(60_000);
  const head = execFileSync('git', ['-C', REPO, 'describe', '--always', '--dirty'], {
    encoding: 'utf8',
  }).trim();
  writeFileSync(
    join(RUN_DIR as string, 'rig.json'),
    `${JSON.stringify(
      { runId, pid: process.pid, ready: ok, bridgePort, controlPort, pin: PIN, build: head },
      null,
      2,
    )}\n`,
  );
  console.log(ok ? 'READY' : 'NOT READY: see homebridge.log');
  if (!ok) {
    await stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
