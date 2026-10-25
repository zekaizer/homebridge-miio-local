# Humidifier

The humidifier shows as one humidifier accessory: power, a mode (*Auto* is the device's
automatic mode, *Humidify* is a manual level), the manual level as a speed (up to 33 % low, up
to 66 % medium, above high), a target humidity kept within 30-80 %, current humidity, water level
and a child lock.

## Sub-features

- `hum-power` turns it on and off.
- `hum-mode` switches between Auto and Humidify.
- `hum-level` sets the manual level through the speed.
- `hum-target` sets the target humidity, clamped to 30-80 %.
- `hum-readings` shows current humidity and water level from the device.
- `hum-lock` turns the child lock on and off.

## How to get to it (user POV)

- Home app: humidifier tile for power; open it for the mode (Auto / Humidifier), target
  humidity, and fan speed in its settings; current humidity and water level are shown in the
  accessory.

## Driving it with ctl.mjs

Preconditions: baseline; humidifier off, mode auto (`"2/5": 0`), target 70 (`"2/6": 70`).

- **Power.** `$C $R set Humidifier Active 1` → `http 204`; `get Humidifier Active` → `1`;
  `fake humidifier` → `"2/1": true`, request `set_properties`.
- **Mode.** `$C $R set Humidifier "Target Humidifier-Dehumidifier State" 1` → `get` → `1`;
  `fake` → `"2/5"` not `0`. Set `0` → `"2/5": 0`.
- **Level.** With mode Humidify, `$C $R set Humidifier "Rotation Speed" 50` → `fake` →
  `"2/5": 2` (medium). `20` → `1`, `90` → `3`.
- **Target.** `$C $R set Humidifier "Relative Humidity Humidifier Threshold" 55` → `get` →
  `55`; `fake` → `"2/6": 55`. Then `90` → device gets `80`; `10` → device gets `30`.
- **Readings.** `$C $R fake humidifier 3/9=52` → `$C $R wait Humidifier "Current Relative
  Humidity" 52`. `fake humidifier 2/7=60` → `get Humidifier "Water Level"` shows the scaled
  percentage (not 60).
- **Lock.** `set Humidifier "Lock Physical Controls" 1` → `fake` → `"6/1": true`; back to `0`.
- Restore: `Active 0`, mode `0`, target `70`.

## Gotchas

- The fake takes writes as the published miot spec says; the real device was never measured
  taking them, and it refused mode writes with `-4002` when its tank was empty. A pass here does
  not prove the real device accepts the write.
- The water level scale is python-miio's guess; check only that the value changes with `"2/7"`.
- HAP may reject a target outside the characteristic's own min/max before the plugin sees it;
  report the HTTP status of such a write rather than assuming clamping happened in the plugin.
