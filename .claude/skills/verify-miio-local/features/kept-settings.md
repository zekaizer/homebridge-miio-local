# Kept settings and night

The buzzer and the light (a fan's indicator light, the humidifier's screen) are not Home
controls. They are config: `buzzer`/`light` set to `on` or `off` keep the device at that value,
also when someone changes it on the device; `unmanaged` leaves it alone. With a `night`
schedule, `buzzerAtNight`/`lightAtNight` give the value during the night, and an `unmanaged` day
value gets back what the device had before the night.

## Sub-features

- `kept-apply` a kept value is written to the device after startup.
- `kept-restore` a device-side change to a kept value is put back.
- `kept-unmanaged` an unmanaged value is never written.
- `night-value` during the night the night value is applied.
- `night-end` after the night an unmanaged setting gets its pre-night value back.

## How to get to it (user POV)

- Homebridge UI / `config.json`: the device's Buzzer, Light, Buzzer at night, Light at night
  settings and the platform's Night start/end. There is nothing to tap in the Home app.

## Driving it with ctl.mjs

Preconditions: baseline; `fan-za1` has `buzzer: 0`, `led_b: 0` (light on).

- **Apply.** `jq '.platforms[0].devices[0].light = "off"' hb/config.json` (write it back),
  `$C $R restart`. Within ~10 s `$C $R fake fan-za1` → `led_b: 2`, request `set_led_b [2]`.
- **Restore.** `$C $R fake fan-za1 led_b=0`; within ~12 s `fake fan-za1` → `led_b: 2` again.
- **Unmanaged.** With `buzzer` not set, `fake fan-za1 buzzer=2`; after 15 s `fake` still shows
  `buzzer: 2` and no `set_buzzer` request.
- **Night.** Set `.platforms[0].night = {"start": "<now - 1 min>", "end": "<now + 3 min>"}`
  (local time of this machine, `HH:MM`) and `lightAtNight: "off"` with `light` unset, while
  `led_b` is `0`; restart. `fake` → `led_b: 2`. After the end time `fake` → `led_b: 0`.
- Repeat Apply on `Humidifier` (`light: "off"` → `"5/2": 0`; `"on"` → `"5/2": 2`).
- Restore the generated config (`down.sh` and `up.sh` give a clean one) before other recipes.

## Gotchas

- Enforcement runs at most every 10 s, after a read; wait 15 s before calling a value not kept.
- The night uses the local time of the machine running the rig; pick start/end around `date`.
- A dim humidifier screen (`"5/2": 1`) counts as on; a kept `on` sets it to bright (`2`).
- Editing `hb/config.json` with `jq` needs a temp file: `jq ... f > f.new && mv f.new f`.
