#!/usr/bin/env node
// Drives one verification instance: HAP reads and writes as the Home app makes them, and the
// fake devices behind it. Every call is appended to <run dir>/transcript.log.
//
// Usage: ctl.mjs <run-id> <command> [args]
//   doctor                            is this instance worth driving
//   list [accessory]                  every characteristic: aid.iid, path, value, perms
//   get <target> <characteristic>     HAP read; it reaches the device through the plugin
//   set <target> <characteristic> <value>
//   wait <target> <characteristic> <value> [seconds]
//   fake <fake-id>                    state and received requests of fan-za1|fan-p33|humidifier
//   fake <fake-id> key=value ...      change it as the remote would; also silent=true, model=...
//   restart                           restart Homebridge on the same storage, wait until ready
// <target> is an accessory name ("Fan ZA1") or accessory/service ("Fan ZA1/Move Left").
// <characteristic> is the HAP description, such as "Rotation Speed".

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const [runId, command, ...args] = process.argv.slice(2);
if (!runId || !command) {
  console.error('usage: ctl.mjs <run-id> <command> [args]; see the header of this file');
  process.exit(2);
}
const runDir = join(REPO, '.local/verify', runId);
const lines = [];
const out = (line) => {
  lines.push(line);
  console.log(line);
};

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const rig = () => {
  const file = join(runDir, 'rig.json');
  if (!existsSync(file)) {
    throw new Error(`run ${runId} is not up: no ${file}`);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
};

const hap = async (path, init = {}) => {
  const { bridgePort, pin } = rig();
  const response = await fetch(`http://127.0.0.1:${bridgePort}${path}`, {
    ...init,
    headers: { 'content-type': 'application/hap+json', authorization: pin, ...init.headers },
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : undefined };
};

const control = async (path, body) => {
  const { controlPort } = rig();
  const response = await fetch(`http://127.0.0.1:${controlPort}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
};

const characteristics = async () => {
  const { data } = await hap('/accessories');
  const rows = [];
  for (const accessory of data.accessories) {
    const nameOf = (service) =>
      service.characteristics.find((c) => c.description === 'Name')?.value;
    const info = accessory.services.find((s) => s.type === '3E');
    const accessoryName = info ? nameOf(info) : `aid ${accessory.aid}`;
    for (const service of accessory.services) {
      const serviceName = nameOf(service) ?? service.type;
      for (const c of service.characteristics) {
        rows.push({
          aid: accessory.aid,
          iid: c.iid,
          accessory: accessoryName,
          service: serviceName,
          primary: service.primary === true,
          name: c.description,
          value: c.value,
          perms: c.perms,
        });
      }
    }
  }
  return rows;
};

const find = async (target, name) => {
  const [accessory, service] = target.split('/');
  const rows = (await characteristics()).filter(
    (row) =>
      row.accessory === accessory &&
      row.name === name &&
      (service === undefined || row.service === service),
  );
  // Without a service name the accessory's own services win over the extra switches.
  const own = service === undefined ? rows.filter((row) => row.service === accessory) : rows;
  const pick = own.length === 1 ? own : rows;
  if (pick.length !== 1) {
    throw new Error(
      pick.length === 0
        ? `no characteristic "${name}" on "${target}"; run list`
        : `"${name}" is ambiguous on "${target}"; name the service as accessory/service`,
    );
  }
  return pick[0];
};

const read = async (row) => {
  const { status, data } = await hap(`/characteristics?id=${row.aid}.${row.iid}`);
  const item = data?.characteristics?.[0];
  return { status, value: item?.value, hapStatus: item?.status };
};

const commands = {
  async doctor() {
    const problems = [];
    let info;
    try {
      info = rig();
    } catch (error) {
      out(`FAIL ${error.message}`);
      return 1;
    }
    const ps = (() => {
      try {
        return execFileSync('ps', ['-o', 'command=', '-p', String(info.pid)], { encoding: 'utf8' });
      } catch {
        return '';
      }
    })();
    if (!ps.includes('verify-miio-local/scripts/rig.ts')) {
      problems.push(`pid ${info.pid} is not this run's rig`);
    }
    try {
      const { data } = await control('/state');
      if (data.runId !== runId) {
        problems.push(`control port ${info.controlPort} answers for run ${data.runId}`);
      }
    } catch (error) {
      problems.push(`control port ${info.controlPort}: ${error.message}`);
    }
    try {
      const rows = await characteristics();
      const models = rows.filter((row) => row.name === 'Model').map((row) => row.value);
      out(`accessories: ${models.join(', ')}`);
      if (models.length !== 4) {
        problems.push(`expected the bridge and 3 accessories, HAP lists ${models.length}`);
      }
    } catch (error) {
      problems.push(`bridge port ${info.bridgePort}: ${error.message}`);
    }
    const log = readFileSync(join(runDir, 'homebridge.log'), 'utf8');
    const errors = log.split('\n').filter((line) => /error/i.test(line));
    if (errors.length > 0) {
      problems.push(`homebridge.log has ${errors.length} error lines, last: ${errors.at(-1)}`);
    }
    const built = statSync(join(REPO, 'dist/index.js')).mtimeMs;
    const newest = execFileSync('git', ['-C', REPO, 'ls-files', 'src'], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((file) => statSync(join(REPO, file)).mtimeMs)
      .reduce((a, b) => Math.max(a, b), 0);
    if (newest > built) {
      problems.push('src/ is newer than dist/: the instance runs a stale build, run up.sh again');
    }
    out(`run ${runId}: pid ${info.pid}, HAP :${info.bridgePort}, control :${info.controlPort}`);
    out(`build ${info.build}, dist built ${new Date(built).toISOString()}`);
    for (const problem of problems) {
      out(`FAIL ${problem}`);
    }
    out(problems.length === 0 ? 'OK' : 'NOT OK');
    return problems.length === 0 ? 0 : 1;
  },

  async list(accessory) {
    for (const row of await characteristics()) {
      if (accessory === undefined || row.accessory === accessory) {
        out(
          `${row.aid}.${row.iid}\t${row.accessory}/${row.service}\t${row.name} = ${JSON.stringify(row.value)}\t[${row.perms}]`,
        );
      }
    }
    return 0;
  },

  async get(target, name) {
    const row = await find(target, name);
    const { status, value, hapStatus } = await read(row);
    out(
      `GET ${target} ${name} (${row.aid}.${row.iid}) -> http ${status} value ${JSON.stringify(value)}${hapStatus ? ` hapStatus ${hapStatus}` : ''}`,
    );
    return status === 200 ? 0 : 1;
  },

  async set(target, name, text) {
    const row = await find(target, name);
    const value = parse(text);
    const { status, data } = await hap('/characteristics', {
      method: 'PUT',
      body: JSON.stringify({ characteristics: [{ aid: row.aid, iid: row.iid, value }] }),
    });
    out(
      `SET ${target} ${name} (${row.aid}.${row.iid}) = ${JSON.stringify(value)} -> http ${status}${data ? ` ${JSON.stringify(data)}` : ''}`,
    );
    return status === 204 ? 0 : 1;
  },

  async wait(target, name, text, seconds = '10') {
    const row = await find(target, name);
    const want = parse(text);
    const until = Date.now() + Number(seconds) * 1000;
    let last;
    while (Date.now() < until) {
      last = await read(row);
      if (last.value === want) {
        out(`WAIT ${target} ${name} == ${JSON.stringify(want)} -> ok`);
        return 0;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    out(
      `WAIT ${target} ${name} == ${JSON.stringify(want)} -> timeout, last ${JSON.stringify(last)}`,
    );
    return 1;
  },

  async fake(id, ...changes) {
    if (changes.length === 0) {
      const { status, data } = await control(`/fake/${id}`);
      const { requests, ...state } = data;
      out(`FAKE ${id} -> http ${status} ${JSON.stringify(state)}`);
      for (const [index, request] of (requests ?? []).slice(-15).entries()) {
        out(
          `  request ${requests.length - Math.min(15, requests.length) + index}: ${request.method} ${JSON.stringify(request.params)}`,
        );
      }
      return status === 200 ? 0 : 1;
    }
    const body = { set: {} };
    for (const change of changes) {
      const [key, text] = change.split('=');
      if (key === 'silent') {
        body.silent = parse(text);
      } else if (key === 'model') {
        body.model = text;
      } else {
        body.set[key] = parse(text);
      }
    }
    const { status, data } = await control(`/fake/${id}`, body);
    out(`FAKE ${id} ${changes.join(' ')} -> http ${status} ${JSON.stringify(data)}`);
    return status === 200 ? 0 : 1;
  },

  async restart() {
    const { status } = await control('/restart', {});
    out(`RESTART -> http ${status}`);
    return status === 200 ? 0 : 1;
  },
};

let code;
try {
  const run = commands[command];
  if (!run) {
    throw new Error(`unknown command ${command}`);
  }
  code = await run(...args);
} catch (error) {
  out(`ERROR ${error.message}`);
  code = 1;
}
if (existsSync(runDir)) {
  appendFileSync(
    join(runDir, 'transcript.log'),
    `[${new Date().toISOString()}] $ ctl ${[command, ...args].map((a) => JSON.stringify(a)).join(' ')} (exit ${code})\n${lines.join('\n')}\n`,
  );
}
process.exit(code);
