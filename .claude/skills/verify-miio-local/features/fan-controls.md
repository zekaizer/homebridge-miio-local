# Fan controls

A fan shows in Home as one fan accessory with power, a 1-100 % speed, oscillation and a child
lock. A control shows its new value at once and the fan follows; setting a speed turns a fan that
is off on.

## Sub-features

- `fan-power` turns each fan off and on.
- `fan-speed` sets the speed while on; the device level follows.
- `fan-speed-turns-on` setting a speed on a fan that is off turns it on at that speed.
- `fan-oscillation` turns oscillation on and off; ignored while the fan is off.
- `fan-lock` turns the child lock on and off.

## How to get to it (user POV)

- Home app: tap the fan tile for power; open it for the speed slider, Oscillate and Lock
  Controls toggles in its settings.
- Siri / scenes / automations: the same HAP writes, possibly power and speed in one request.

## Driving it with ctl.mjs

Preconditions: baseline; both fans on at level 25.

- **Speed.** `$C $R set "Fan ZA1" "Rotation Speed" 60` → `http 204`. `$C $R get "Fan ZA1"
  "Rotation Speed"` → `60`. `$C $R fake fan-za1` → `speed_level: 60`, request
  `set_speed_level [60]`. On `Fan P33` the same write gives `"2/6": 80`-style props
  (`"2/6"` = level, `"2/2"` = the derived 1-4 gear) and a `set_properties` request.
- **Power off.** `$C $R set "Fan ZA1" Active 0` → `http 204`; `get ... Active` → `0`;
  `fake fan-za1` → `power: "off"`, request `set_power ["off"]`. `Fan P33`: `"2/1": false`.
- **Speed turns on.** With the fan off, `$C $R set "Fan ZA1" "Rotation Speed" 30` →
  `get ... Active` → `1`; `fake fan-za1` shows `set_power ["on"]` then `set_speed_level [30]`.
- **Oscillation.** `$C $R set "Fan ZA1" "Swing Mode" 1` → `get` → `1`; `fake` →
  `angle_enable: "on"` (`Fan P33`: `"2/4": true`). Set `0` and check it goes back. With the fan
  off, a `Swing Mode` write must not change the fake.
- **Child lock.** `$C $R set "Fan ZA1" "Lock Physical Controls" 1` → `get` → `1`; `fake` →
  `child_lock: "on"` (`Fan P33`: `"7/1": true`). Set back to `0`.
- Repeat every step on `Fan P33`. Restore: `Active 1`, `Rotation Speed 25`.

## Gotchas

- `"Rotation Speed" 0` is how the Home app sends "off" together with power; it is not a level.
- The Home app may send `Active 0` and a speed in one request. `ctl.mjs set` sends one
  characteristic per request; to prove the combined case, send a raw PUT with both
  (`curl -X PUT -H "Authorization: <pin from rig.json>" -d '{"characteristics":[...]}'
  http://127.0.0.1:<bridgePort>/characteristics`) and expect the fan to end up off.
- A fan in natural wind (`fake fan-za1 mode=natural natural_level=25`) stays in natural wind when
  the speed changes: expect `set_natural_level`, not `set_speed_level`.
