# homebridge-miio-local verification map

The maintained source for verifying what a Home app user gets from this plugin. Read this index,
then use the matching feature file as the recipe. `ctl.mjs` and the run layout are described in
[../SKILL.md](../SKILL.md).

## Baseline preconditions

- A run started with `scripts/up.sh <run-id>` from the current checkout, and `ctl.mjs <run-id>
  doctor` printing `OK`.
- The generated config, unchanged: `Fan ZA1`, `Fan P33` (both with move switches) and
  `Humidifier`, all polled every 2 s, no `night`, no kept buzzer or light.
- Fake defaults: both fans on at level 25, oscillation off, lock off; the humidifier off, mode
  auto, target humidity 70 %, humidity 47 %, water level 0.
- Never drive an instance this run did not start, and never the deployed Homebridge.

## Driving conventions

- `C=.claude/skills/verify-miio-local/scripts/ctl.mjs` and `R=<run-id>` in every recipe.
- Address characteristics by accessory name and HAP description, never by aid/iid: those
  depend on registration order.
- Both fan models must be covered where a recipe says "each fan": they speak different dialects
  and go through different code.
- A recipe that changes config edits `.local/verify/$R/hb/config.json` with `jq` and runs
  `$C $R restart`. Put the config back and restart before the next recipe.

## Proof and skip reporting

- Each step pairs the user action (`set`, or a `fake` change for device-side events) with the
  resulting HAP state (`get`/`wait`) and the device side (`fake <id>` props and the miio request).
- Quote lines from `.local/verify/$R/transcript.log` and `homebridge.log` with the run dir path.
- Report a step that cannot be reached with the command tried and the unmet precondition. Do not
  report a skipped fan model as verified through the other one.
- Humidifier writes are proven against the fake only; the real device's write behaviour was not
  measured. Say so in the report.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible
behaviour, then exactly four H2 sections in this order: `Sub-features`, `How to get to it (user
POV)`, `Driving it with ctl.mjs`, `Gotchas`.

## Features

- [Fan controls](./fan-controls.md): power, speed, oscillation and child lock on each fan.
- [Move switches](./fan-move-switches.md): the Move Left / Move Right switches that turn the head.
- [Humidifier](./humidifier.md): power, Auto/Humidify mode, manual level, target humidity, readings.
- [Availability and sync](./availability.md): device-side changes, No Response, recovery, restart,
  another model at the address.
- [Kept settings and night](./kept-settings.md): `buzzer`/`light` kept at a value, night values.
