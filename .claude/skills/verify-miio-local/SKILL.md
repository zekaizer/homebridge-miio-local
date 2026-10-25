---
name: verify-miio-local
description: Drive the homebridge-miio-local plugin end to end through HAP, the protocol the Apple Home app speaks, against fake Xiaomi fans and a fake humidifier on localhost. Use to prove a change to the plugin works in a real Homebridge (accessories appear, HAP writes reach the device, device changes reach HAP, No Response), not only in unit tests.
---

# Verify homebridge-miio-local

The user surface is Apple Home. The Home app talks HAP to Homebridge, Homebridge runs this plugin,
and the plugin talks miio over UDP to the devices. This skill replaces both ends that cannot be
driven by an agent: HAP requests are made with `curl`-style HTTP against a Homebridge started in
insecure mode (`-I`), and the devices are `test/support/fake-device.ts`, the same fakes the tests
use, which follow the measured behaviour in `docs/local-api.md`.

One instance ("run") is: three fake devices on `127.0.0.1` UDP, one Homebridge with its own
storage dir and a free HAP port, and a control HTTP server for the fakes. Everything lives under
`.local/verify/<run-id>/` (git-ignored). Runs with different ids do not share anything and can
run side by side.

Never drive the deployed Homebridge or the real devices from this skill. Those are covered in
"Real devices" below and need the user's permission for every write.

## Launch

```
.claude/skills/verify-miio-local/scripts/up.sh <run-id>
```

It runs `npm run build`, starts the rig in the background and returns once it is ready, printing
`rig.json` and `READY run=<id> dir=<run dir>`. It fails with the log tail otherwise. Ready means
HAP lists the bridge and all three accessories, which happens only after the plugin identified
each fake with `miIO.info`; about 5 s from a clean storage dir.

The accessories, each backed by one fake:

| Accessory (HAP name) | Fake id | Model | Extra config |
|---|---|---|---|
| `Fan ZA1` | `fan-za1` | `zhimi.fan.za1` (legacy miio) | `moveSwitches: true` |
| `Fan P33` | `fan-p33` | `dmaker.fan.p33` (miot) | `moveSwitches: true` |
| `Humidifier` | `humidifier` | `zhimi.humidifier.ca4` (miot) | |

All have `pollInterval: 2` (the default is 15) so that device-side changes show within seconds.
The generated config is `.local/verify/<run-id>/hb/config.json`; to test other settings, edit it
and run `ctl.mjs <run-id> restart`.

Prerequisites: `npm install` has been run, and `jq` is on `PATH`.

## Doctor

Run first, and again whenever anything looks off:

```
.claude/skills/verify-miio-local/scripts/ctl.mjs <run-id> doctor
```

Read-only. Prints `OK` or `NOT OK` with a `FAIL` line per problem. It checks that the pid in
`rig.json` is this run's rig, the control port answers for this run id, HAP lists the bridge and
the three models, `homebridge.log` has no error lines, and `dist/` is not older than `src/`
(a stale build means the instance runs code other than the one under test: run `up.sh` again
after `down.sh`).

## Drive

All driving goes through one helper. Each call prints one result line and appends the command
and its output to `.local/verify/<run-id>/transcript.log`.

```
C=.claude/skills/verify-miio-local/scripts/ctl.mjs
$C <run> list [accessory]                     # aid.iid, accessory/service, name = value, perms
$C <run> get <target> <characteristic>        # HAP read; goes through the plugin's onGet
$C <run> set <target> <characteristic> <value>   # HAP write, as the Home app sends it
$C <run> wait <target> <characteristic> <value> [seconds]
$C <run> fake <fake-id>                       # fake state + last 15 miio requests it received
$C <run> fake <fake-id> key=value ...         # change the device as its remote would
$C <run> fake <fake-id> silent=true|false     # unplug / plug back in
$C <run> fake <fake-id> model=<model>         # another device takes the address
$C <run> restart                              # restart Homebridge, same storage and fakes
```

- `<target>` is an accessory name, or `accessory/service` for the extra switches:
  `"Fan ZA1"`, `"Fan ZA1/Move Left"`. `<characteristic>` is the HAP description as `list`
  prints it: `Active`, `"Rotation Speed"`, `"Swing Mode"`, `"Lock Physical Controls"`, `On`,
  `"Target Humidifier-Dehumidifier State"`, `"Relative Humidity Humidifier Threshold"`,
  `"Current Relative Humidity"`, `"Water Level"`.
- Values are JSON: `1`, `0`, `60`, `true`. HAP enums are numbers (`Active` 1/0, `Swing Mode`
  1/0, `Lock Physical Controls` 1/0, humidifier target state 0 = Auto, 1 = Humidify).
- `set` succeeds with `http 204`. A refused write comes back as `http 207` with a HAP status.
  `get` on a device shown as No Response prints `http 207 ... hapStatus -70402`.
- Fake property keys: `fan-za1` uses legacy names (`power` `"on"`/`"off"`, `speed_level`,
  `angle_enable`, `child_lock`, `buzzer`, `led_b`). `fan-p33` and `humidifier` use miot
  `"siid/piid"` keys; `fake <id>` prints the current map. The meaning of each key is in
  `docs/local-api.md` and `src/models/`.

Feature recipes are in [features/README.md](features/README.md). Read the matching feature file
before proving a feature; it lists every entry point that must be covered.

## Evidence

A proof has three views of the same change, all captured by the commands above:

1. The user action: the `set` line (HAP write and its HTTP status).
2. The state the user sees afterwards: a `get` or `wait` line read back through HAP.
3. The side effect on the device: `fake <id>`, showing the changed property and the miio
   request the plugin sent (`set_speed_level [60]`, `set_properties [...]`).

For changes that start at the device (remote, unplugging), the order is reversed: `fake ... key=`
first, then `wait` on HAP. Add the matching `homebridge.log` lines (the plugin logs each read and
write at debug level, and warnings such as `no reply from the fan`).

Rules:

- Drive through HAP only. Do not call plugin classes or test helpers to cause the change: that
  skips Homebridge and hap-nodejs, which is what this skill exists to cover.
- The fakes are the boundary, and they are not the real devices. A proof here says the plugin
  does the right thing against measured device behaviour. For the humidifier, writes were never
  measured: say so when a proof depends on humidifier writes.
- Evidence stays in `.local/verify/<run-id>/`: `transcript.log`, `homebridge.log`, `rig.out`.
  Copy anything else you want to keep (for example `fake` output saved with `> file`) into the
  same dir. Quote the relevant lines in the report, with the run dir path.

## Cleanup

```
.claude/skills/verify-miio-local/scripts/down.sh <run-id>
```

It sends SIGTERM to the rig pid recorded in `rig.json` (only if that pid is this run's rig),
which stops Homebridge and closes the fakes, then deletes `hb/` (storage, cached accessories,
generated config). It keeps the evidence and lists what is left in the run dir. Never kill
`homebridge` or `node` by name: the user's editor runs node processes, and other runs may be up.
Run `down.sh` after every failed attempt too. The evidence dir of an old run can be removed with
`rm -rf .local/verify/<run-id>` once its findings are reported.

## Gotchas

- Homebridge advertises the verification bridge over mDNS as `Miio Verify <run-id>`. It is not
  paired with anything and disappears at `down.sh`. Do not pair it.
- A miio request to a silent device takes 3 attempts of 6 s before the plugin gives up, so No
  Response shows about 20-25 s after `silent=true`, not at the next poll.
- `fake ... power=off` on a fan is a remote change: it shows at the next poll (2 s).
- `get` and `wait` make the characteristic read the Home app makes. `list` reads the whole
  accessory database; use it to find names, and `get`/`wait` for proof.
- Kept buzzer and light settings are enforced at most every 10 s.

## Real devices

The real fans and humidifier, and the deployed Homebridge, are described in `.local/NOTES.md`
(not committed): addresses, where the tokens are, the HAP port of the deployed child bridge and
its scripts in `.local/tools/`. Reading state there is allowed. Any write to a real device,
including a HAP `PUT` to the deployed bridge, needs the user's permission for that run, and the
device must be put back as it was. Installing or restarting the deployed plugin needs the user's
confirmation too.
